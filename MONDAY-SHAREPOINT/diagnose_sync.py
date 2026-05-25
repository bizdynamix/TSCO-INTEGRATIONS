#!/usr/bin/env python3
"""
Diagnostic script — tests each step of the Monday→SharePoint sync in isolation.
Run: python3 diagnose_sync.py <item_id>
"""

import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Import helpers from the handler
from webhook_handler import (
    get_item_column_details,
    get_asset_download_url,
    download_file,
    get_graph_token,
    get_sharepoint_site_id,
    get_site_drive_id,
    ensure_folder_exists,
    upload_file_to_sharepoint,
    SHAREPOINT_HOSTNAME,
    SHAREPOINT_SITE_PATH,
)
import requests

# ── Config check ────────────────────────────────────────────────────────────

def check_env():
    required = ["MONDAY_API_TOKEN", "TENANT_ID", "CLIENT_ID", "CLIENT_SECRET"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        print(f"❌ Missing env vars: {missing}")
        return False
    print("✅ All env vars present")
    return True

# ── Monday checks ────────────────────────────────────────────────────────────

def check_monday_item(item_id: int):
    print(f"\n── Monday: item {item_id} ──────────────────────────────────")
    details = get_item_column_details(item_id)
    if not details:
        print("❌ Could not fetch item details from Monday")
        return None
    print(f"  file_column_id : {details.get('file_column_id')}")
    print(f"  file_has_value : {details.get('file_has_value')}")
    print(f"  mou_end_date   : {details.get('mou_end_date')}")
    if not details.get("file_column_id"):
        print("❌ No Language Profile column found — check column title contains 'Language Profile'")
    if not details.get("file_has_value"):
        print("❌ Language Profile column has no file — upload a file to Monday first")
    return details

def check_file_download(item_id: int, file_col_id: str):
    print(f"\n── Monday: download asset ──────────────────────────────────")
    url = get_asset_download_url(item_id, file_col_id)
    if not url:
        print("❌ No downloadable asset URL found")
        return None
    print(f"✅ Asset URL: {url[:100]}...")
    local = download_file(url)
    size = local.stat().st_size
    print(f"✅ Downloaded → {local}  ({size:,} bytes)")
    return local

# ── SharePoint checks ────────────────────────────────────────────────────────

def check_sharepoint_auth():
    print(f"\n── SharePoint: auth ────────────────────────────────────────")
    try:
        token = get_graph_token()
        print(f"✅ Graph token obtained (len={len(token)})")
        return token
    except Exception as e:
        print(f"❌ Auth failed: {e}")
        return None

def check_sharepoint_site(token: str):
    print(f"\n── SharePoint: site + drive ────────────────────────────────")
    try:
        site_id = get_sharepoint_site_id(token)
        print(f"✅ Site ID: {site_id}")
        drive_id = get_site_drive_id(site_id, token)
        print(f"✅ Drive ID: {drive_id}")
        return site_id, drive_id
    except Exception as e:
        print(f"❌ Site/drive lookup failed: {e}")
        return None, None

def check_folder_creation(drive_id: str, folder_name: str, token: str):
    print(f"\n── SharePoint: folder '{folder_name}' ──────────────────────")
    # Check if it already exists
    from urllib.parse import quote
    encoded = quote(folder_name)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code == 200:
        print(f"✅ Folder already exists: {folder_name}")
        data = resp.json()
        print(f"   webUrl: {data.get('webUrl', 'N/A')}")
        return True
    elif resp.status_code == 404:
        print(f"  Folder not found — will try to create it")
        try:
            result = ensure_folder_exists(drive_id, folder_name, token)
            print(f"✅ Folder created: {folder_name}")
            return True
        except Exception as e:
            print(f"❌ Folder creation failed: {e}")
            # Print response detail if available
            try:
                detail = resp.json()
                print(f"   Error detail: {json.dumps(detail, indent=2)}")
            except Exception:
                pass
            return False
    else:
        print(f"❌ Unexpected response checking folder: {resp.status_code}")
        try:
            print(f"   Body: {resp.text[:400]}")
        except Exception:
            pass
        return False

def check_upload(drive_id: str, folder_name: str, local_path: Path, token: str):
    print(f"\n── SharePoint: upload ──────────────────────────────────────")
    try:
        result = upload_file_to_sharepoint(drive_id, folder_name, local_path.name, local_path, token)
        print(f"✅ Upload succeeded")
        print(f"   webUrl: {result.get('webUrl', 'N/A')}")
        return True
    except Exception as e:
        print(f"❌ Upload failed: {e}")
        return False

# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 diagnose_sync.py <monday_item_id> [folder_name]")
        print("       folder_name defaults to TEST_SYNC_DIAGNOSTIC")
        sys.exit(1)

    item_id = int(sys.argv[1])
    test_folder = sys.argv[2] if len(sys.argv) > 2 else "TEST_SYNC_DIAGNOSTIC"

    print("=" * 60)
    print(f"  SYNC DIAGNOSTIC — item {item_id}")
    print(f"  SharePoint: {SHAREPOINT_HOSTNAME}{SHAREPOINT_SITE_PATH}")
    print(f"  Test folder: {test_folder}")
    print("=" * 60)

    if not check_env():
        sys.exit(1)

    # Monday checks
    details = check_monday_item(item_id)
    if not details:
        sys.exit(1)

    local_path = None
    if details.get("file_column_id") and details.get("file_has_value"):
        local_path = check_file_download(item_id, details["file_column_id"])

    # SharePoint checks (always run, even if no file)
    token = check_sharepoint_auth()
    if not token:
        sys.exit(1)

    site_id, drive_id = check_sharepoint_site(token)
    if not drive_id:
        sys.exit(1)

    # Use real project name uppercased if we have details; else use test folder
    folder_to_test = test_folder
    check_folder_creation(drive_id, folder_to_test, token)

    if local_path:
        check_upload(drive_id, folder_to_test, local_path, token)
        try:
            local_path.unlink()
        except Exception:
            pass
    else:
        print("\n⚠️  Skipping upload test — no file downloaded from Monday")

    print("\n" + "=" * 60)
    print("  DIAGNOSTIC COMPLETE")
    print("=" * 60)
