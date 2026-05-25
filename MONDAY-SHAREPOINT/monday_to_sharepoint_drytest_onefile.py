#!/usr/bin/env python3
"""
Monday.com to SharePoint File Migration - DRY TEST (One File)

This script tests the migration pipeline by processing exactly ONE file.
By default, it runs in dry-run mode (downloads only, no upload).

Example usage:
    # Dry run (download only, no upload)
    python monday_to_sharepoint_drytest_onefile.py

    # Actually upload the file
    python monday_to_sharepoint_drytest_onefile.py --upload

    # Force re-download even if file exists
    python monday_to_sharepoint_drytest_onefile.py --upload --force

Environment variables required:
    MONDAY_API_TOKEN        - Monday.com API token
    TENANT_ID               - Azure AD tenant ID
    CLIENT_ID               - Azure AD app client ID
    CLIENT_SECRET           - Azure AD app client secret
    SHAREPOINT_HOSTNAME     - (optional) default: seedcompany.sharepoint.com
    SHAREPOINT_SITE_PATH    - (optional) default: /sites/ActiveProjects
    TEST_UPLOAD_FOLDER      - (optional) default: Projects/_TEST_MondayUpload
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import requests
from urllib.parse import quote

# Cache for SharePoint list IDs to avoid repeated API calls
_list_id_cache: Dict[str, str] = {}

# ============================================================================
# Configuration
# ============================================================================


class Config:
    """Configuration loaded from environment variables."""

    def __init__(self):
        self.monday_api_token = os.getenv("MONDAY_API_TOKEN")
        self.tenant_id = os.getenv("TENANT_ID")
        self.client_id = os.getenv("CLIENT_ID")
        self.client_secret = os.getenv("CLIENT_SECRET")
        self.sharepoint_hostname = os.getenv(
            "SHAREPOINT_HOSTNAME", "seedcompany.sharepoint.com"
        )
        self.sharepoint_site_path = os.getenv(
            "SHAREPOINT_SITE_PATH", "/sites/ActiveProjects"
        )
        self.test_upload_folder = os.getenv(
            "TEST_UPLOAD_FOLDER", "Projects/_TEST_MondayUpload"
        )

        # Monday board configuration
        self.monday_board_id = "8445103301"
        self.column_title_files = "Language Profile"
        self.column_title_project = "Partner Project Name"
        self.column_title_mou_end_date = "MOU End"

        # API endpoints
        self.monday_api_url = "https://api.monday.com/v2"
        self.graph_token_url = (
            f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        )
        self.graph_api_base = "https://graph.microsoft.com/v1.0"

    def validate(self):
        """Validate that all required config is present."""
        missing = []
        if not self.monday_api_token:
            missing.append("MONDAY_API_TOKEN")
        if not self.tenant_id:
            missing.append("TENANT_ID")
        if not self.client_id:
            missing.append("CLIENT_ID")
        if not self.client_secret:
            missing.append("CLIENT_SECRET")

        if missing:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}"
            )


# ============================================================================
# Monday.com API Functions
# ============================================================================


def monday_api_request(
    query: str, variables: Optional[Dict] = None, api_token: str = None
) -> Dict:
    """Execute a Monday.com GraphQL query."""
    headers = {"Authorization": api_token, "Content-Type": "application/json"}

    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    response = requests.post(
        "https://api.monday.com/v2",
        json=payload,
        headers=headers)
    response.raise_for_status()

    result = response.json()
    if "errors" in result:
        raise Exception(f"Monday API error: {result['errors']}")

    return result["data"]


def get_board_columns(board_id: str, api_token: str) -> List[Dict]:
    """Get all columns from a Monday board."""
    query = """
    query ($boardId: [ID!]) {
        boards(ids: $boardId) {
            columns {
                id
                title
                type
            }
        }
    }
    """

    variables = {"boardId": board_id}
    data = monday_api_request(query, variables, api_token)

    if not data["boards"]:
        raise Exception(f"Board {board_id} not found")

    return data["boards"][0]["columns"]


def resolve_column_ids(
    board_id: str, api_token: str, target_titles: List[str]
) -> Dict[str, str]:
    """Resolve column IDs by their titles."""
    columns = get_board_columns(board_id, api_token)

    title_to_id = {}
    for col in columns:
        if col["title"] in target_titles:
            title_to_id[col["title"]] = col["id"]

    print(f"\n📋 Resolved Monday columns:")
    for title in target_titles:
        col_id = title_to_id.get(title, "NOT FOUND")
        print(f"   • '{title}' → {col_id}")

    missing = [t for t in target_titles if t not in title_to_id]
    if missing:
        raise Exception(f"Could not find columns: {missing}")

    return title_to_id


def get_board_items_with_files(
    board_id: str, column_ids: List[str], api_token: str
) -> List[Dict]:
    """Get board items with specific column values and assets."""
    query = """
    query ($boardId: [ID!], $columnIds: [String!]) {
        boards(ids: $boardId) {
            items_page(limit: 100) {
                items {
                    id
                    name
                    column_values(ids: $columnIds) {
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
        }
    }
    """

    variables = {"boardId": board_id, "columnIds": column_ids}

    data = monday_api_request(query, variables, api_token)

    if not data["boards"]:
        raise Exception(f"Board {board_id} not found")

    return data["boards"][0]["items_page"]["items"]


def find_first_valid_item(
    items: List[Dict],
    file_col_id: str,
    project_col_id: str,
    mou_col_id: Optional[str] = None,
) -> Optional[Tuple[Dict, str, Dict, Optional[str]]]:
    """Find the first item with a project name and at least one file.

    Returns: (item, project_name, file_asset, mou_end_date) or None
    """
    for item in items:
        project_name = None
        file_asset = None
        mou_end_date = None

        # Parse column values
        for col_val in item["column_values"]:
            if col_val["id"] == project_col_id:
                project_name = col_val["text"]
            elif mou_col_id and col_val["id"] == mou_col_id:
                # Date stored in text for date-only columns in Monday
                mou_end_date = col_val.get("text") or None
            elif col_val["id"] == file_col_id:
                # Try to parse the file column value
                if col_val["value"]:
                    try:
                        file_data = json.loads(col_val["value"])
                        if "files" in file_data and file_data["files"]:
                            # We have files, now match with assets
                            file_info = file_data["files"][0]
                            asset_id = file_info.get("assetId")

                            # Find matching asset
                            for asset in item.get("assets", []):
                                if str(asset["id"]) == str(asset_id):
                                    file_asset = asset
                                    break
                    except json.JSONDecodeError:
                        pass

        # If we couldn't parse from column value, just take first asset
        if not file_asset and item.get("assets"):
            file_asset = item["assets"][0]

        # Check if this item is valid
        if project_name and project_name.strip() and file_asset:
            return (item, project_name.strip(), file_asset, mou_end_date)

    return None


def download_file(url: str, local_path: Path, force: bool = False) -> bool:
    """Download a file from URL to local path.

    Returns: True if downloaded, False if skipped (already exists)
    """
    if local_path.exists() and not force:
        print(f"   ⏭️  File already exists (use --force to re-download)")
        return False

    # Create parent directory
    local_path.parent.mkdir(parents=True, exist_ok=True)

    # Download file
    response = requests.get(url, stream=True)
    response.raise_for_status()

    with open(local_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    return True


# ============================================================================
# Microsoft Graph API Functions
# ============================================================================


def get_graph_access_token(
        tenant_id: str,
        client_id: str,
        client_secret: str) -> str:
    """Get Microsoft Graph access token using client credentials flow."""
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }

    response = requests.post(token_url, data=data)
    response.raise_for_status()

    return response.json()["access_token"]


def get_sharepoint_site_id(
        hostname: str,
        site_path: str,
        access_token: str) -> str:
    """Get SharePoint site ID."""
    url = f"https://graph.microsoft.com/v1.0/sites/{hostname}:{site_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    return response.json()["id"]


def get_site_drive_id(site_id: str, access_token: str) -> str:
    """Get the default document library drive ID for a site."""
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    return response.json()["id"]


def ensure_folder_exists(
        drive_id: str,
        folder_path: str,
        access_token: str) -> bool:
    """Ensure a folder exists in SharePoint, create if it doesn't.

    Returns: True if folder was created, False if it already existed
    """
    # Split the path into parts
    parts = [p for p in folder_path.split("/") if p]
    current_path = ""

    for part in parts:
        current_path = f"{current_path}/{part}" if current_path else part
        encoded_path = quote(current_path)

        # Check if folder exists
        check_url = (
            f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        response = requests.get(check_url, headers=headers)

        if response.status_code == 404:
            # Create folder
            parent_path = "/".join(current_path.split("/")[:-1])
            if parent_path:
                create_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{
                    quote(parent_path)}:/children"
            else:
                create_url = (
                    f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children")

            data = {
                "name": part,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "fail",
            }

            create_response = requests.post(
                create_url, json=data, headers=headers)

            if create_response.status_code not in [
                    201, 409]:  # 409 = already exists
                create_response.raise_for_status()

            print(f"   📁 Created folder: {current_path}")

    return True


def file_exists_in_sharepoint(
    drive_id: str, folder_path: str, filename: str, access_token: str
) -> bool:
    """Return True if file already exists at folder_path/filename"""
    full_path = f"{folder_path}/{filename}"
    encoded_path = quote(full_path)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    response = requests.get(url, headers=headers)
    return response.status_code == 200


def get_drive_item_by_path(
        drive_id: str,
        item_path: str,
        access_token: str) -> Dict:
    """Get a drive item (file or folder) by path"""
    encoded_path = quote(item_path)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()


def set_folder_metadata(
    site_id: str,
    drive_id: str,
    folder_path: str,
    fields: Dict[str, str],
    access_token: str,
) -> Dict:
    """Set metadata fields on a folder (maps to SharePoint list item fields)."""
    from urllib.parse import quote
    import time

    # Get drive item for the folder
    encoded_path = quote(folder_path)
    item_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Sometimes need to wait a moment after folder creation
    time.sleep(1)

    item_resp = requests.get(item_url, headers=headers)
    item_resp.raise_for_status()
    item = item_resp.json()
    item_id = item["id"]

    # Get the listItem associated with this drive item
    li_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/listItem"
    )

    li_resp = requests.get(li_url, headers=headers)
    li_resp.raise_for_status()
    li_data = li_resp.json()

    # Update the list item fields
    list_item_id = li_data["id"]

    # Get list ID from sharepoint IDs (prefer cached if available)
    sp_ids = li_data.get("sharepointIds", {})
    list_id = sp_ids.get("listId")

    if not list_id:
        # Fallback: try to find from site lists (cached)
        cache_key = f"{site_id}:Active Projects"
        list_id = _list_id_cache.get(cache_key)
        if not list_id:
            # Get lists to find Active Projects list
            lists_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists"
            lists_resp = requests.get(lists_url, headers=headers)
            lists_resp.raise_for_status()
            lists = lists_resp.json().get("value", [])

            for lst in lists:
                if (
                    lst.get("displayName") == "Active Projects"
                    or lst.get("name") == "Active Projects"
                ):
                    list_id = lst["id"]
                    _list_id_cache[cache_key] = list_id
                    break

    if not list_id:
        raise Exception("Could not resolve list ID from folder item")

    # Update fields
    patch_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{list_item_id}/fields"

    patch_resp = requests.patch(patch_url, json=fields, headers=headers)
    patch_resp.raise_for_status()
    return patch_resp.json()


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

    with open(local_file_path, "rb") as f:
        response = requests.put(url, data=f, headers=headers)

    response.raise_for_status()
    return response.json()


# ============================================================================
# Main Script
# ============================================================================


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Monday.com to SharePoint migration - DRY TEST (one file)"
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Actually upload the file to SharePoint (default: dry run only)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download even if file exists locally",
    )

    args = parser.parse_args()

    print("=" * 70)
    print("🧪 MONDAY → SHAREPOINT DRY TEST (ONE FILE)")
    print("=" * 70)

    if not args.upload:
        print("\n⚠️  DRY RUN MODE - Will download but NOT upload")
        print("   Use --upload flag to actually upload to SharePoint\n")
    else:
        print("\n✅ UPLOAD MODE - Will download AND upload to SharePoint\n")

    # Load and validate configuration
    try:
        config = Config()
        config.validate()
        print(f"✓ Configuration loaded")
        print(f"  • Monday Board: {config.monday_board_id}")
        print(
            f"  • SharePoint Site: {
                config.sharepoint_hostname}{
                config.sharepoint_site_path}")
        print(f"  • Test Upload Folder: {config.test_upload_folder}")
    except Exception as e:
        print(f"\n❌ Configuration error: {e}")
        return 1

    try:
        # Step 1: Resolve Monday column IDs
        print(f"\n🔍 Step 1: Resolving Monday columns...")
        column_map = resolve_column_ids(
            config.monday_board_id,
            config.monday_api_token,
            [
                config.column_title_files,
                config.column_title_project,
                config.column_title_mou_end_date,
            ],
        )

        file_col_id = column_map[config.column_title_files]
        project_col_id = column_map[config.column_title_project]
        mou_col_id = column_map[config.column_title_mou_end_date]

        # Step 2: Fetch board items
        print(f"\n📥 Step 2: Fetching Monday board items...")
        items = get_board_items_with_files(
            config.monday_board_id,
            [file_col_id, project_col_id, mou_col_id],
            config.monday_api_token,
        )
        print(f"   ✓ Retrieved {len(items)} items")

        # Step 3: Find first valid item
        print(f"\n🎯 Step 3: Finding first valid item with file...")
        result = find_first_valid_item(
            items, file_col_id, project_col_id, mou_col_id)

        if not result:
            print("   ❌ No valid items found (need project name + file)")
            return 1

        item, project_name, file_asset, mou_end_date = result
        print(f"   ✓ Found valid item:")
        print(f"     • Item: {item['name']}")
        print(f"     • Project: {project_name}")
        print(f"     • File: {file_asset['name']}")

        # Step 4: Download file
        print(f"\n⬇️  Step 4: Downloading file...")
        local_dir = Path("./downloads/_drytest") / project_name
        local_file = local_dir / file_asset["name"]

        print(f"   • Source: {file_asset['public_url']}")
        print(f"   • Destination: {local_file}")

        downloaded = download_file(
            file_asset["public_url"], local_file, args.force)

        if downloaded:
            file_size = local_file.stat().st_size
            print(f"   ✓ Downloaded {file_size:,} bytes")
        else:
            file_size = local_file.stat().st_size
            print(f"   ✓ Using existing file ({file_size:,} bytes)")

        # Step 5: Upload to SharePoint (if --upload flag is set)
        if args.upload:
            print(f"\n⬆️  Step 5: Uploading to SharePoint...")

            # Get access token
            print(f"   • Authenticating with Microsoft Graph...")
            access_token = get_graph_access_token(
                config.tenant_id, config.client_id, config.client_secret
            )
            print(f"   ✓ Access token obtained")

            # Get site ID
            print(f"   • Resolving SharePoint site ID...")
            site_id = get_sharepoint_site_id(
                config.sharepoint_hostname,
                config.sharepoint_site_path,
                access_token)
            print(f"   ✓ Site ID: {site_id}")

            # Get drive ID
            print(f"   • Getting document library drive ID...")
            drive_id = get_site_drive_id(site_id, access_token)
            print(f"   ✓ Drive ID: {drive_id}")

            # Target folder: use test folder under project name so we can
            # validate per-project behavior
            target_folder = f"{config.test_upload_folder}/{project_name}"

            # Ensure folder exists (will create if needed)
            ensure_folder_exists(drive_id, target_folder, access_token)

            # If we have an MOU end date on the Monday item, set it as folder
            # metadata
            if mou_end_date:
                try:
                    print(
                        f"   • Setting MOU End Date metadata on folder: {mou_end_date}")
                    set_folder_metadata(
                        site_id,
                        drive_id,
                        target_folder,
                        {"MOUenddate0": mou_end_date},
                        access_token,
                    )
                    print(f"   ✓ MOU metadata set")
                except Exception as e:
                    print(f"   ⚠️  Could not set MOU metadata: {e}")

            # Check if file already exists
            if file_exists_in_sharepoint(
                drive_id, target_folder, file_asset["name"], access_token
            ):
                print(f"   ⏭️  File already exists in SharePoint, skipping upload")
            else:
                print(
                    f"   • Uploading file to: {target_folder}/{file_asset['name']}")
                result = upload_file_to_sharepoint(
                    drive_id,
                    target_folder,
                    file_asset["name"],
                    local_file,
                    access_token,
                )

                print(f"   ✓ File uploaded successfully!")
                print(f"   • SharePoint ID: {result['id']}")
                print(f"   • Web URL: {result.get('webUrl', 'N/A')}")
        else:
            print(f"\n⏭️  Step 5: Skipping upload (dry run mode)")
            print(
                f"   • Would upload to: {config.test_upload_folder}/{file_asset['name']}"
            )
            print(f"   • Run with --upload flag to actually upload")

        # Summary
        print("\n" + "=" * 70)
        print("✅ DRY TEST COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"\n📊 Summary:")
        print(f"   • Downloaded: {local_file}")
        print(f"   • File size: {file_size:,} bytes")

        if args.upload:
            print(
                f"   • Uploaded to: {config.test_upload_folder}/{file_asset['name']}")
            print(f"\n✅ Upload successful! Pipeline is working correctly.")
        else:
            print(
                f"   • Ready to upload to: {config.test_upload_folder}/{file_asset['name']}"
            )
            print(f"\n💡 Run with --upload flag to test the actual upload")

        return 0

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
