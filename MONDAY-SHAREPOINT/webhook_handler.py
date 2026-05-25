#!/usr/bin/env python3
"""
Monday.com Webhook Handler — Language Profile to SharePoint Sync

Flask app deployed on Monday Code. Two trigger paths:
  POST /sync-language-profile  — legacy Vibe automation trigger
  POST /monday/action          — Monday workflow action block (preferred)

Sync gate (both triggers): Language Status == "Active" AND Language Profile
column has a file attached. If either condition fails the request is ignored.

Environment variables (via Monday Code secrets):
    MONDAY_API_TOKEN, TENANT_ID, CLIENT_ID, CLIENT_SECRET,
    SHAREPOINT_HOSTNAME, SHAREPOINT_SITE_PATH
"""

import os
import json
import logging
import uuid
import requests
from typing import Dict, Optional, Tuple
from pathlib import Path
from urllib.parse import quote, unquote
from datetime import datetime
import time

from flask import Flask, request, jsonify
from dotenv import load_dotenv

# Load environment
load_dotenv()

# ============================================================================
# Configuration
# ============================================================================

app = Flask(__name__)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MONDAY_API_TOKEN = os.getenv("MONDAY_API_TOKEN")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
SHAREPOINT_HOSTNAME = os.getenv("SHAREPOINT_HOSTNAME", "seedcompany.sharepoint.com")
SHAREPOINT_SITE_PATH = os.getenv("SHAREPOINT_SITE_PATH", "/sites/ActiveProjects")
# Cloud Run injects PORT; fall back to FLASK_PORT, then 5000
FLASK_PORT = int(os.getenv("PORT") or os.getenv("FLASK_PORT", 5000))
FLASK_HOST = os.getenv("FLASK_HOST", "0.0.0.0")

# Temp directory for downloaded files
TEMP_DIR = Path("/tmp/monday-webhook-downloads")
TEMP_DIR.mkdir(exist_ok=True, parents=True)

# Cache for SharePoint tokens and list IDs
_token_cache: Dict[str, Tuple[str, float]] = {}  # {key: (token, expiry_time)}
_list_id_cache: Dict[str, str] = {}

# In-memory subscription store for Monday workflow block lifecycle payloads.
# Monday Code restarts clear this. That is acceptable for challenge handling and
# short-lived troubleshooting, but it is not sufficient for a durable custom trigger.
_subscriptions: Dict[str, Dict] = {}

_RUNTIME_CONFIG_DEFAULTS = {
    "MONDAY_API_TOKEN": MONDAY_API_TOKEN,
    "TENANT_ID": TENANT_ID,
    "CLIENT_ID": CLIENT_ID,
    "CLIENT_SECRET": CLIENT_SECRET,
    "SHAREPOINT_HOSTNAME": SHAREPOINT_HOSTNAME,
    "SHAREPOINT_SITE_PATH": SHAREPOINT_SITE_PATH,
}


def get_runtime_config(name: str, default: Optional[str] = None) -> Optional[str]:
    """Read runtime config, preferring the active environment over import-time values."""
    return os.getenv(name) or _RUNTIME_CONFIG_DEFAULTS.get(name) or default

# ============================================================================
# Validation
# ============================================================================


def validate_config() -> bool:
    """Validate that all required env vars are set."""
    required = ["MONDAY_API_TOKEN", "TENANT_ID", "CLIENT_ID", "CLIENT_SECRET"]
    missing = [k for k in required if not get_runtime_config(k)]
    if missing:
        logger.error(f"Missing environment variables: {missing}")
        return False
    logger.info("✓ Configuration validated")
    return True


# ============================================================================
# Monday.com API Functions
# ============================================================================


def monday_api_request(query: str, variables: Optional[Dict] = None, api_token: Optional[str] = None) -> Dict:
    """Execute a Monday.com GraphQL query."""
    token = api_token or get_runtime_config("MONDAY_API_TOKEN")
    if not token:
        raise RuntimeError("Missing MONDAY_API_TOKEN. Set it with mapps code:env.")
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "API-Version": "2024-01",
    }

    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    logger.debug(f"Monday API request: {query[:100]}...")
    response = requests.post(
        "https://api.monday.com/v2",
        json=payload,
        headers=headers,
        timeout=30
    )
    response.raise_for_status()

    result = response.json()
    if "errors" in result and result["errors"]:
        raise Exception(f"Monday GraphQL error: {result['errors']}")

    return result.get("data", {})


def get_item_column_details(item_id: int, api_token: Optional[str] = None) -> Dict:
    """Fetch item's column values to find file column and MOU date."""
    query = """
    query ($itemId: ID!) {
        items(ids: [$itemId]) {
            name
            board { columns { id title } }
            column_values {
                id
                type
                text
                value
            }
            assets {
                id
                name
                public_url
                url
            }
        }
    }
    """
    try:
        data = monday_api_request(query, {"itemId": str(item_id)}, api_token)
        logger.info(f"Monday API response keys: {list(data.keys()) if data else 'empty'}")
        items = data.get("items", [])
        logger.info(f"Items count: {len(items)}")
        if not items:
            logger.warning(f"No items returned for item_id={item_id}. Full data: {data}")
            return {}

        item = items[0]
        col_titles = {c["id"]: c["title"] for c in item.get("board", {}).get("columns", [])}

        result = {
            "item_name": item.get("name"),
            "file_column_id": None,
            "file_has_value": False,
            "mou_end_date": None,
            "language_status": None,
        }
        for col in item.get("column_values", []):
            col_id = col.get("id", "")
            title = col_titles.get(col_id, "")
            col_type = col.get("type", "")
            text = col.get("text") or ""
            value = col.get("value")

            title_lower = title.lower()
            if "lang" in title_lower and "status" in title_lower:
                result["language_status"] = text

            if col_type == "file" or "Language Profile" in title:
                has_value = False
                if value and value not in ("{}", "null"):
                    try:
                        file_data = json.loads(value)
                        has_value = bool(file_data.get("files"))
                    except (json.JSONDecodeError, AttributeError):
                        pass
                logger.info(f"    File column [{col_id}]: has_file={has_value}")
                # Prefer the first column that actually has a file. Only fall
                # back to an empty file column if no populated one is found.
                if has_value and not result["file_has_value"]:
                    result["file_column_id"] = col_id
                    result["file_has_value"] = True
                elif not result["file_column_id"]:
                    result["file_column_id"] = col_id
            elif "MOU" in title or "mou" in title.lower():
                result["mou_end_date"] = text

        logger.info(
            f"  File column: {result['file_column_id']}, has_file: {result['file_has_value']}, "
            f"MOU: {result['mou_end_date']}, status: {result['language_status']}"
        )
        return result
    except Exception as e:
        logger.error(f"Error fetching item column details: {e}")
        return {}


def get_asset_download_url(item_id: int, file_col_id: str, api_token: Optional[str] = None) -> Optional[str]:
    """Get the download URL for a file asset from a Monday file column."""
    query = """
    query ($itemId: ID!, $columnId: String!) {
        items(ids: [$itemId]) {
            column_values(ids: [$columnId]) {
                id
                text
                value
                type
            }
            assets {
                id
                name
                url
                file_extension
                public_url
            }
        }
    }
    """

    variables = {"itemId": str(item_id), "columnId": file_col_id}

    try:
        data = monday_api_request(query, variables, api_token)

        if not data.get("items"):
            logger.warning(f"Item {item_id} not found")
            return None

        item = data["items"][0]
        col_values = item.get("column_values", [])
        
        # Find the file column
        for col_val in col_values:
            if col_val.get("type") == "file":
                # Try to parse the value as JSON
                try:
                    file_data = json.loads(col_val.get("value", "{}"))
                    if "files" in file_data and file_data["files"]:
                        file_info = file_data["files"][0]
                        asset_id = file_info.get("assetId")

                        # Find matching asset in the item's assets
                        for asset in item.get("assets", []):
                            if str(asset["id"]) == str(asset_id):
                                url = asset.get("public_url") or asset.get("url")
                                logger.info(f"✓ Found asset: {asset['name']} → {url[:80]}...")
                                return url
                except (json.JSONDecodeError, KeyError):
                    pass

        logger.warning(f"No file asset found in column {file_col_id} for item {item_id}")
        return None

    except Exception as e:
        logger.error(f"Error fetching asset URL: {e}")
        raise


def download_file(url: str, filename: Optional[str] = None) -> Path:
    """Download file from URL to temp directory."""
    if not filename:
        filename = unquote(url.split("/")[-1].split("?")[0]) or "downloaded_file"

    local_path = TEMP_DIR / filename
    
    logger.info(f"⬇️  Downloading: {url[:100]}...")
    response = requests.get(url, stream=True, timeout=60)
    response.raise_for_status()

    with open(local_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    file_size_mb = local_path.stat().st_size / (1024 * 1024)
    logger.info(f"✓ Downloaded {file_size_mb:.2f}MB → {local_path}")
    return local_path


# ============================================================================
# Microsoft Graph API Functions
# ============================================================================


def get_graph_token() -> str:
    """Get Microsoft Graph access token using client credentials flow."""
    cache_key = "graph_token"
    
    # Check if token is cached and still valid
    if cache_key in _token_cache:
        token, expiry_time = _token_cache[cache_key]
        if time.time() < expiry_time:
            logger.debug("✓ Using cached Graph token")
            return token

    tenant_id = get_runtime_config("TENANT_ID")
    client_id = get_runtime_config("CLIENT_ID")
    client_secret = get_runtime_config("CLIENT_SECRET")

    missing = [
        name for name, value in {
            "TENANT_ID": tenant_id,
            "CLIENT_ID": client_id,
            "CLIENT_SECRET": client_secret,
        }.items() if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required Monday Code environment variables: {missing}. "
            "Set them with mapps code:env and redeploy the app."
        )

    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }

    logger.info("🔐 Requesting new Graph access token...")
    response = requests.post(token_url, data=data, timeout=30)
    response.raise_for_status()

    result = response.json()
    token = result["access_token"]
    expires_in = result.get("expires_in", 3600)
    
    # Cache token, expire 5 min before actual expiry
    expiry_time = time.time() + expires_in - 300
    _token_cache[cache_key] = (token, expiry_time)

    logger.info(f"✓ Graph token obtained (expires in {expires_in}s)")
    return token


def get_sharepoint_site_id(access_token: str) -> str:
    """Get SharePoint site ID."""
    hostname = get_runtime_config("SHAREPOINT_HOSTNAME", "seedcompany.sharepoint.com")
    site_path = get_runtime_config("SHAREPOINT_SITE_PATH", "/sites/ActiveProjects")
    url = f"https://graph.microsoft.com/v1.0/sites/{hostname}:{site_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    logger.info(f"Fetching SharePoint site ID: {SHAREPOINT_HOSTNAME}{SHAREPOINT_SITE_PATH}")
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    site_id = response.json()["id"]
    logger.info(f"✓ Site ID: {site_id}")
    return site_id


def get_site_drive_id(site_id: str, access_token: str) -> str:
    """Get the default document library drive ID for a site."""
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    logger.info("Fetching SharePoint drive ID...")
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    drives = response.json().get("value", [])
    drive = next((d for d in drives if d.get("name") == "Active Projects"), None)
    if not drive:
        drive = next((d for d in drives if d.get("driveType") == "documentLibrary"), None)
    if not drive:
        raise Exception(f"No document library drive found. Available: {[d.get('name') for d in drives]}")

    drive_id = drive["id"]
    logger.info(f"✓ Drive ID: {drive_id} ({drive.get('name')})")
    return drive_id


def ensure_folder_exists(drive_id: str, folder_path: str, access_token: str) -> bool:
    """Ensure a folder exists in SharePoint, create if it doesn't."""
    parts = [p for p in folder_path.split("/") if p]
    current_path = ""

    for part in parts:
        current_path = f"{current_path}/{part}" if current_path else part
        encoded_path = quote(current_path)

        check_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        response = requests.get(check_url, headers=headers, timeout=30)

        if response.status_code == 404:
            # Create folder
            parent_path = "/".join(current_path.split("/")[:-1])
            if parent_path:
                create_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{quote(parent_path)}:/children"
            else:
                create_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children"

            data = {
                "name": part,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "replace",
            }

            logger.info(f"📁 Creating folder: {current_path}")
            create_response = requests.post(create_url, json=data, headers=headers, timeout=30)

            if create_response.status_code not in [201, 409]:
                create_response.raise_for_status()
        else:
            logger.debug(f"✓ Folder exists: {current_path}")

    return True


def upload_file_to_sharepoint(
    drive_id: str,
    folder_path: str,
    filename: str,
    local_file_path: Path,
    access_token: str,
) -> Dict:
    """Upload a file to SharePoint using simple upload API."""
    # Ensure folder exists
    ensure_folder_exists(drive_id, folder_path, access_token)

    # Upload file
    full_path = f"{folder_path}/{filename}"
    encoded_path = quote(full_path)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}:/content"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream",
    }

    logger.info(f"📤 Uploading to SharePoint: {full_path}")
    with open(local_file_path, "rb") as f:
        response = requests.put(url, data=f, headers=headers, timeout=120)

    response.raise_for_status()
    
    result = response.json()
    web_url = result.get("webUrl", "")
    logger.info(f"✓ File uploaded: {web_url}")
    
    return result


def set_folder_metadata(
    site_id: str,
    drive_id: str,
    folder_path: str,
    fields: Dict[str, str],
    access_token: str,
) -> Dict:
    """Set metadata fields on a folder."""
    # Get drive item for the folder
    encoded_path = quote(folder_path)
    item_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Wait a moment after folder creation
    time.sleep(0.5)

    logger.info(f"🏷️  Setting metadata on: {folder_path}")
    item_resp = requests.get(item_url, headers=headers, timeout=30)
    item_resp.raise_for_status()
    item = item_resp.json()
    item_id = item["id"]

    # Get the listItem
    li_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/listItem"
    li_resp = requests.get(li_url, headers=headers, timeout=30)
    li_resp.raise_for_status()
    li_data = li_resp.json()

    list_item_id = li_data["id"]
    sp_ids = li_data.get("sharepointIds", {})
    list_id = sp_ids.get("listId")

    if not list_id:
        # Try cache or fetch lists
        cache_key = f"{site_id}:Active Projects"
        list_id = _list_id_cache.get(cache_key)
        
        if not list_id:
            lists_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists"
            lists_resp = requests.get(lists_url, headers=headers, timeout=30)
            lists_resp.raise_for_status()
            lists = lists_resp.json().get("value", [])

            for lst in lists:
                if lst.get("displayName") == "Active Projects":
                    list_id = lst["id"]
                    _list_id_cache[cache_key] = list_id
                    break

    if not list_id:
        logger.warning("Could not resolve list ID, skipping metadata")
        return {}

    # Update fields
    patch_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{list_item_id}/fields"
    
    logger.debug(f"Patching fields: {fields}")
    patch_resp = requests.patch(patch_url, json=fields, headers=headers, timeout=30)
    
    if patch_resp.status_code >= 400:
        logger.warning(f"Metadata patch failed ({patch_resp.status_code}): {patch_resp.text[:200]}")
        return {}

    logger.info(f"✓ Metadata set: {fields}")
    return patch_resp.json()


# ============================================================================
# Webhook Payload Parsing
# ============================================================================


def parse_webhook_payload(payload: Dict) -> Dict:
    """Extract item details from Monday webhook payload."""
    logger.info("Parsing Monday webhook payload...")
    payload_preview = json.dumps(payload, indent=2)[:3000]
    logger.info(f"Full payload:\n{payload_preview}")

    # Monday Vibe wraps everything in an "event" key
    # Payload fields: pulseId (item id), pulseName (item name), boardId, columnId, value, previousValue
    event = payload.get("event", payload)

    item_id = event.get("pulseId")
    project_name = event.get("pulseName")
    board_id = event.get("boardId")

    logger.info(f"Extracted: pulseId={item_id}, pulseName={project_name}, boardId={board_id}")

    if not item_id or not project_name:
        logger.error(f"Missing required fields. event keys: {list(event.keys())}")
        raise ValueError("Missing item_id or project_name in payload")

    # The changed column value is in event.value (for status changes)
    language_status = None
    column_title = event.get("columnTitle", "")
    value = event.get("value", {})
    if isinstance(value, dict) and "label" in value:
        language_status = value["label"].get("text")

    logger.info(f"✓ Parsed: item_id={item_id}, project={project_name}, board={board_id}")
    logger.info(f"  Changed column: {column_title}, new value: {language_status}")

    # Column values are NOT included in the webhook payload — we'll query the API for file/MOU data
    return {
        "item_id": item_id,
        "project_name": project_name,
        "board_id": board_id,
        "language_status": language_status,
        "trigger_column": column_title,
        # These will be populated by a subsequent API query in the main handler
        "file_column_id": None,
        "file_has_value": None,
        "fpm_user_id": None,
        "mou_end_date": None,
    }


# ============================================================================
# Main Webhook Endpoint
# ============================================================================


@app.route("/", methods=["GET", "POST"])
def root():
    """Root route — handles Monday challenge verification at the base URL."""
    if request.method == "GET":
        challenge = request.args.get("challenge")
        if challenge:
            return jsonify({"challenge": challenge}), 200
        return jsonify({"status": "ok", "service": "Monday-SharePoint Sync"}), 200
    payload = request.get_json(force=True, silent=True) or {}
    if "challenge" in payload:
        return jsonify({"challenge": payload["challenge"]}), 200
    return jsonify({"status": "ok"}), 200


@app.route("/sync-language-profile", methods=["GET", "POST"])
def sync_language_profile():
    """Handle Monday challenge verification and webhook events."""
    # GET challenge (query param)
    if request.method == "GET":
        challenge = request.args.get("challenge")
        if challenge:
            logger.info(f"✅ Monday GET challenge: {challenge}")
            return jsonify({"challenge": challenge}), 200
        return jsonify({"status": "ok"}), 200

    logger.info(f"\n{'='*70}")
    logger.info("📨 WEBHOOK RECEIVED")
    logger.info(f"{'='*70}")

    try:
        # Parse request
        payload = request.get_json(force=True, silent=True) or {}

        # POST challenge verification (Monday sends {"challenge": "..."} in body)
        if "challenge" in payload:
            challenge = payload["challenge"]
            logger.info(f"✅ Monday POST challenge: {challenge}")
            return jsonify({"challenge": challenge}), 200

        if not payload:
            return jsonify({"success": False, "error": "Empty payload"}), 400

        logger.info(f"Payload keys: {list(payload.keys())}")

        # Parse Monday item details from webhook
        parsed = parse_webhook_payload(payload)
        item_id = parsed["item_id"]
        project_name = parsed["project_name"]
        language_status = parsed["language_status"]
        trigger_column = parsed.get("trigger_column", "")

        logger.info(f"Item: {project_name} (ID: {item_id})")
        logger.info(f"Trigger column: {trigger_column}, new value: {language_status}")

        # Webhook doesn't include all column values — query Monday for file/MOU data
        logger.info("🔍 Fetching item column details from Monday API...")
        col_details = get_item_column_details(item_id)
        file_column_id = col_details.get("file_column_id")
        has_file = col_details.get("file_has_value", False)
        mou_end_date = col_details.get("mou_end_date")

        logger.info(f"Has Language Profile file: {has_file}")
        logger.info(f"MOU End Date: {mou_end_date}")

        # TRIGGER conditions (check file column trigger FIRST, since it doesn't require Status in payload)
        # Trigger 1: Language Profile column was modified AND has file → SYNC (regardless of Language Status)
        if has_file and file_column_id and "Language Profile" in trigger_column:
            logger.info("🎯 Language Profile file column modified — syncing")
            trigger_reason = "profile_column_modified"
        # Trigger 2: Language Status changed to "Active" AND has file → SYNC
        elif language_status == "Active" and has_file and file_column_id:
            logger.info("🎯 Language Status is Active with file — syncing")
            trigger_reason = "status_active_with_file"
        else:
            # No trigger condition met — ignore
            if language_status and language_status != "Active":
                logger.info(f"⏭️  Language Status is '{language_status}' (not 'Active'), ignoring")
                reason = "status_not_active"
            elif not has_file:
                logger.info(f"⏭️  No Language Profile file found for {project_name}, ignoring")
                reason = "no_file"
            else:
                logger.info(f"⏭️  No recognized trigger condition met, ignoring")
                reason = "no_trigger"
            return jsonify({
                "success": False,
                "project_name": project_name,
                "item_id": item_id,
                "reason": reason,
                "action": "ignore",
            }), 200
        try:
            logger.info(f"\n🔄 Starting SharePoint sync for: {project_name}")

            # Step 1: Get file download URL from Monday
            logger.info("\n📥 Step 1: Fetching file from Monday...")
            file_url = get_asset_download_url(item_id, file_column_id)
            
            if not file_url:
                logger.error(f"Could not find file download URL for item {item_id}")
                return jsonify({
                    "success": False,
                    "project_name": project_name,
                    "error": "No downloadable file found"
                }), 400

            # Step 2: Download file
            logger.info(f"\n⬇️  Step 2: Downloading file...")
            local_path = download_file(file_url)
            filename = local_path.name

            # Step 3: Authenticate with SharePoint
            logger.info(f"\n🔐 Step 3: Authenticating with SharePoint...")
            access_token = get_graph_token()
            site_id = get_sharepoint_site_id(access_token)
            drive_id = get_site_drive_id(site_id, access_token)

            # Step 4: Upload to SharePoint
            logger.info(f"\n📤 Step 4: Uploading to SharePoint...")
            # Project name in UPPERCASE as folder name
            folder_path = project_name.upper()
            upload_result = upload_file_to_sharepoint(
                drive_id,
                folder_path,
                filename,
                local_path,
                access_token
            )

            # Step 5: Set folder metadata (MOU End Date)
            logger.info(f"\n🏷️  Step 5: Setting folder metadata...")
            if mou_end_date:
                metadata = {
                    "MOUenddate0": mou_end_date  # SharePoint field name
                }
                try:
                    set_folder_metadata(site_id, drive_id, folder_path, metadata, access_token)
                except Exception as e:
                    logger.warning(f"Failed to set metadata: {e}")

            # Step 6: Clean up local file
            try:
                local_path.unlink()
                logger.info(f"✓ Cleaned up: {local_path}")
            except Exception as e:
                logger.warning(f"Could not delete temp file: {e}")

            # Success!
            sharepoint_url = upload_result.get("webUrl", "")
            logger.info(f"\n✅ SYNC COMPLETE")
            logger.info(f"   Project: {project_name}")
            logger.info(f"   File: {filename}")
            logger.info(f"   SharePoint: {sharepoint_url}")

            return jsonify({
                "success": True,
                "project_name": project_name,
                "item_id": item_id,
                "filename": filename,
                "sharepoint_url": sharepoint_url,
                "folder_path": folder_path,
                "notification": f"✅ Language Profile synced to SharePoint: {sharepoint_url}",
            }), 200

        except Exception as e:
            logger.error(f"❌ SharePoint sync failed: {e}", exc_info=True)
            return jsonify({
                "success": False,
                "project_name": project_name,
                "item_id": item_id,
                "error": str(e),
                "notification": f"❌ Failed to sync to SharePoint: {str(e)}",
            }), 500

    except Exception as e:
        logger.error(f"❌ Webhook processing failed: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e),
        }), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "ok"}), 200


# ============================================================================
# Monday Workflow Block Endpoints
# (Used when the app exposes action blocks inside Monday Workflow Builder)
# ============================================================================


@app.route("/monday/subscribe", methods=["POST"])
def monday_subscribe():
    """Called by Monday when a workflow subscription is created or verified."""
    payload = request.get_json(force=True, silent=True) or {}

    if "challenge" in payload:
        return jsonify({"challenge": payload["challenge"]}), 200

    webhook_id = str(uuid.uuid4())
    _subscriptions[webhook_id] = {
        "payload": payload,
        "created_at": datetime.utcnow().isoformat(),
    }
    logger.info(f"✅ Subscribed: webhookId={webhook_id}")
    return jsonify({"webhookId": webhook_id}), 200


@app.route("/monday/unsubscribe", methods=["POST"])
def monday_unsubscribe():
    """Called by Monday when a workflow subscription is removed."""
    payload = request.get_json(force=True, silent=True) or {}

    if "challenge" in payload:
        return jsonify({"challenge": payload["challenge"]}), 200

    webhook_id = payload.get("webhookId") or payload.get("payload", {}).get("webhookId")
    if webhook_id:
        _subscriptions.pop(webhook_id, None)
        logger.info(f"✅ Unsubscribed: webhookId={webhook_id}")
    return jsonify({"result": "unsubscribed"}), 200


@app.route("/monday/action", methods=["POST"])
def monday_action():
    """Called by Monday when the workflow action block runs."""
    payload = request.get_json(force=True, silent=True) or {}

    if "challenge" in payload:
        return jsonify({"challenge": payload["challenge"]}), 200

    logger.info(f"\n{'='*70}")
    logger.info("📨 MONDAY WORKFLOW ACTION RECEIVED")
    logger.info(f"{'='*70}")
    logger.info(f"RAW PAYLOAD: {payload}")

    # NOTE: The Authorization header Monday sends on action callbacks is a
    # signed verification JWT (audience = this app), NOT a Monday API token.
    # Passing it to api.monday.com returns 401. Always use the stored
    # MONDAY_API_TOKEN secret for GraphQL calls.
    request_token = None
    logger.info("Using stored MONDAY_API_TOKEN for Monday API calls")

    try:
        # Monday has shipped action payloads in multiple shapes. Prefer
        # inboundFieldValues, but keep the legacy inputFields fallback.
        action_payload = payload.get("payload", payload)
        if "inboundFieldValues" in payload:
            input_fields = payload["inboundFieldValues"]
        elif isinstance(action_payload, dict) and "inboundFieldValues" in action_payload:
            input_fields = action_payload["inboundFieldValues"]
        else:
            input_fields = action_payload.get("inputFields", action_payload)
        logger.info(f"input_fields keys: {list(input_fields.keys()) if isinstance(input_fields, dict) else type(input_fields)}")
        logger.info(f"input_fields values: {input_fields}")

        item_id_raw = input_fields.get("itemId") or input_fields.get("item_id")
        if not item_id_raw:
            logger.error(f"Missing itemId in action payload. Full payload: {payload}")
            return jsonify({"success": False, "error": "Missing itemId"}), 400

        item_id = int(item_id_raw)
        logger.info(f"Item ID: {item_id}")

        # Fetch item details (name, file column, MOU date)
        logger.info("🔍 Fetching item column details from Monday API...")
        col_details = get_item_column_details(item_id, api_token=request_token)
        project_name = col_details.get("item_name")
        file_column_id = col_details.get("file_column_id")
        has_file = col_details.get("file_has_value", False)
        mou_end_date = col_details.get("mou_end_date")
        language_status = (col_details.get("language_status") or "").strip()

        if not project_name:
            return jsonify({"success": False, "error": f"Item {item_id} not found"}), 404

        logger.info(
            f"Project: {project_name}, status={language_status!r}, has_file={has_file}, MOU={mou_end_date}"
        )

        # Sync only when BOTH conditions are met: Language Status is "Active"
        # AND a Language Profile file is attached.
        if language_status.lower() != "active":
            logger.info(f"⏭️  Language Status is {language_status!r} (not Active), ignoring {project_name}")
            return jsonify({
                "success": False,
                "reason": "status_not_active",
                "project_name": project_name,
                "language_status": language_status,
                "message": "Language Status is not Active — nothing to sync",
            }), 200

        if not has_file or not file_column_id:
            logger.info(f"⏭️  No Language Profile file found for {project_name}, ignoring")
            return jsonify({
                "success": False,
                "reason": "no_file",
                "project_name": project_name,
                "message": "No Language Profile file attached — nothing to sync",
            }), 200

        # Run the SharePoint sync
        logger.info(f"\n🔄 Starting SharePoint sync for: {project_name}")

        file_url = get_asset_download_url(item_id, file_column_id, api_token=request_token)
        if not file_url:
            return jsonify({"success": False, "error": "No downloadable file found"}), 400

        local_path = download_file(file_url)
        filename = local_path.name

        access_token = get_graph_token()
        site_id = get_sharepoint_site_id(access_token)
        drive_id = get_site_drive_id(site_id, access_token)

        folder_path = project_name.upper()
        upload_result = upload_file_to_sharepoint(drive_id, folder_path, filename, local_path, access_token)

        if mou_end_date:
            try:
                set_folder_metadata(site_id, drive_id, folder_path, {"MOUenddate0": mou_end_date}, access_token)
            except Exception as e:
                logger.warning(f"Failed to set metadata: {e}")

        try:
            local_path.unlink()
        except Exception:
            pass

        sharepoint_url = upload_result.get("webUrl", "")
        logger.info(f"\n✅ SYNC COMPLETE: {project_name} → {sharepoint_url}")

        return jsonify({
            "success": True,
            "project_name": project_name,
            "item_id": item_id,
            "filename": filename,
            "sharepoint_url": sharepoint_url,
        }), 200

    except Exception as e:
        logger.error(f"❌ Action failed: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# Main Entry Point
# ============================================================================


if __name__ == "__main__":
    print("\n" + "="*70)
    print("🚀 MONDAY WEBHOOK HANDLER")
    print("="*70)

    if not validate_config():
        logger.warning("Missing environment variables — starting anyway, endpoints will fail until secrets are available")

    logger.info(f"SharePoint: {SHAREPOINT_HOSTNAME}{SHAREPOINT_SITE_PATH}")
    logger.info(f"Listening: http://{FLASK_HOST}:{FLASK_PORT}")
    logger.info(f"Endpoint: POST /sync-language-profile")
    logger.info("="*70 + "\n")

    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=False)
