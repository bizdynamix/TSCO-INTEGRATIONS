#!/usr/bin/env python3
"""
Test upload for Western Krahn language project
"""

import requests
from monday_to_sharepoint_drytest_onefile import (
    Config,
    resolve_column_ids,
    get_board_items_with_files,
    download_file,
    get_graph_access_token,
    get_sharepoint_site_id,
    file_exists_in_sharepoint,
    ensure_folder_exists,
    set_folder_metadata,
    upload_file_to_sharepoint,
)
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json

sys.path.insert(0, str(Path(__file__).parent))


def get_active_projects_drive_id(site_id: str, access_token: str) -> str:
    """Get the drive ID for 'Active Projects' document library."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
    response = requests.get(url, headers=headers)
    response.raise_for_status()

    drives = response.json().get("value", [])

    for drive in drives:
        if drive.get("name") == "Active Projects":
            return drive["id"]

    return drives[0]["id"] if drives else None


def find_project_by_name(
    items: List[Dict],
    search_name: str,
    file_col_id: str,
    project_col_id: str,
    mou_col_id: str,
) -> Optional[Tuple[Dict, str, Dict, Optional[str]]]:
    """Find a project by name (partial match)."""
    search_lower = search_name.lower()

    for item in items:
        project_name = None
        file_asset = None
        mou_end_date = None

        for col_val in item["column_values"]:
            if col_val["id"] == project_col_id:
                project_name = col_val["text"]
            elif col_val["id"] == mou_col_id:
                mou_end_date = col_val.get("text") or None
            elif col_val["id"] == file_col_id:
                if col_val["value"]:
                    try:
                        file_data = json.loads(col_val["value"])
                        if "files" in file_data and file_data["files"]:
                            file_info = file_data["files"][0]
                            asset_id = file_info.get("assetId")

                            for asset in item.get("assets", []):
                                if str(asset["id"]) == str(asset_id):
                                    file_asset = asset
                                    break
                    except json.JSONDecodeError:
                        pass

        if not file_asset and item.get("assets"):
            file_asset = item["assets"][0]

        if project_name and search_lower in project_name.lower() and file_asset:
            return (item, project_name.strip(), file_asset, mou_end_date)

    return None


def main():
    print("=" * 70)
    print("🧪 WESTERN KRAHN TEST UPLOAD")
    print("=" * 70)

    config = Config()
    config.validate()
    print(f"\n✓ Configuration loaded")

    # Resolve columns
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
    print(f"   ✓ Columns resolved")

    # Fetch items
    print(f"\n📥 Step 2: Fetching Monday board items...")
    items = get_board_items_with_files(
        config.monday_board_id,
        [file_col_id, project_col_id, mou_col_id],
        config.monday_api_token,
    )
    print(f"   ✓ Retrieved {len(items)} items")

    # Find Western Krahn
    print(f"\n🎯 Step 3: Searching for Western Krahn...")
    result = find_project_by_name(
        items, "Western Krahn", file_col_id, project_col_id, mou_col_id
    )

    if not result:
        print("   ❌ Western Krahn project not found")
        return 1

    item, project_name, file_asset, mou_end_date = result
    print(f"   ✓ Found project: {project_name}")
    print(f"   • Item: {item['name']}")
    print(f"   • File: {file_asset['name']}")
    if mou_end_date:
        print(f"   • MOU End: {mou_end_date}")

    # Download file
    print(f"\n⬇️  Step 4: Downloading file...")
    local_dir = Path("./downloads/_test") / project_name
    local_file = local_dir / file_asset["name"]

    downloaded = download_file(
        file_asset["public_url"],
        local_file,
        force=True)
    file_size = local_file.stat().st_size

    if downloaded:
        print(f"   ✓ Downloaded {file_size:,} bytes")
    else:
        print(f"   ✓ Using existing file ({file_size:,} bytes)")

    # Upload to SharePoint
    print(f"\n⬆️  Step 5: Uploading to SharePoint...")

    print(f"   • Authenticating...")
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    print(f"   ✓ Authenticated")

    print(f"   • Resolving site...")
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    print(f"   ✓ Site resolved")

    print(f"   • Getting Active Projects drive...")
    drive_id = get_active_projects_drive_id(site_id, access_token)
    print(f"   ✓ Drive ID: {drive_id}")

    # Upload directly to project folder (not under Projects/)
    target_folder = project_name

    print(f"\n   • Target: {target_folder}/{file_asset['name']}")

    # Check if file exists
    if file_exists_in_sharepoint(
        drive_id, target_folder, file_asset["name"], access_token
    ):
        print(f"   ⏭️  File already exists in SharePoint - SKIPPING upload")
        print(f"\n✅ Test complete - file already exists, no changes made")
        return 0

    # Ensure folder exists
    print(f"   • Creating folder if needed...")
    ensure_folder_exists(drive_id, target_folder, access_token)
    print(f"   ✓ Folder ready")

    # Set MOU metadata if available
    if mou_end_date:
        try:
            print(f"   • Setting MOU End Date: {mou_end_date}")
            set_folder_metadata(
                site_id,
                drive_id,
                target_folder,
                {"MOUenddate0": mou_end_date},
                access_token,
            )
            print(f"   ✓ Metadata set")
        except Exception as e:
            print(f"   ⚠️  Could not set metadata: {e}")

    # Upload
    print(f"   • Uploading file...")
    result = upload_file_to_sharepoint(
        drive_id, target_folder, file_asset["name"], local_file, access_token
    )

    print(f"   ✓ Upload successful!")
    print(f"\n   📍 SharePoint Location:")
    print(f"      {result.get('webUrl', 'N/A')}")

    print("\n" + "=" * 70)
    print("✅ WESTERN KRAHN TEST COMPLETED SUCCESSFULLY")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
