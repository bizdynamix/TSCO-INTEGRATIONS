#!/usr/bin/env python3
"""
Compare Monday.com Language Profiles with SharePoint and show what's missing.
Dry run - does not upload anything, just shows what would be synced.
"""

import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import (
    Config, resolve_column_ids, get_graph_access_token, get_sharepoint_site_id
)
from bulk_migrate_all import get_active_projects_drive_id
import requests


def get_all_monday_profiles(config):
    """Get all items from Monday with Language Profile files that have ACTIVE status."""
    print("📥 Fetching Monday.com board data...")
    
    column_map = resolve_column_ids(
        config.monday_board_id,
        config.monday_api_token,
        [config.column_title_files, config.column_title_project, config.column_title_mou_end_date]
    )
    
    file_col_id = column_map[config.column_title_files]
    project_col_id = column_map[config.column_title_project]
    mou_col_id = column_map[config.column_title_mou_end_date]
    lang_status_col_id = "status"  # Lang Status column
    
    query = """
    query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
            items_page(limit: 500) {
                items {
                    id
                    name
                    column_values {
                        id
                        text
                        value
                    }
                    assets {
                        id
                        name
                        public_url
                    }
                }
            }
        }
    }
    """
    
    headers = {
        "Authorization": config.monday_api_token,
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        "https://api.monday.com/v2",
        json={"query": query, "variables": {"boardId": [config.monday_board_id]}},
        headers=headers
    )
    data = response.json()
    items = data.get("data", {}).get("boards", [{}])[0].get("items_page", {}).get("items", [])
    
    profiles = []
    skipped_inactive = 0
    
    for item in items:
        project_name = None
        mou_end_date = None
        file_info = None
        file_asset = None
        lang_status = None
        
        for col in item.get("column_values", []):
            if col["id"] == project_col_id:
                project_name = col.get("text", "")
            elif col["id"] == mou_col_id:
                mou_end_date = col.get("text")
            elif col["id"] == lang_status_col_id:
                lang_status = col.get("text", "").strip().upper()
            elif col["id"] == file_col_id and col.get("value"):
                try:
                    file_data = json.loads(col["value"])
                    if "files" in file_data and file_data["files"]:
                        file_info = file_data["files"][0]
                        asset_id = file_info.get("assetId")
                        
                        for asset in item.get("assets", []):
                            if str(asset["id"]) == str(asset_id):
                                file_asset = asset
                                break
                except json.JSONDecodeError:
                    pass
        
        # Only include items with ACTIVE status
        if lang_status != "ACTIVE":
            if project_name and file_asset:
                skipped_inactive += 1
            continue
        
        if project_name and project_name.strip() and file_asset:
            profiles.append({
                "item_id": item["id"],
                "item_name": item["name"],
                "project_name": project_name.strip(),
                "folder_name": project_name.strip().upper(),
                "file_name": file_asset["name"],
                "file_url": file_asset["public_url"],
                "mou_end_date": mou_end_date,
                "lang_status": lang_status
            })
    
    print(f"   ✓ Found {len(profiles)} ACTIVE projects with Language Profile files")
    print(f"   ⏭️  Skipped {skipped_inactive} non-ACTIVE projects with files")
    
    return profiles


def get_sharepoint_files(config):
    """Get all folders and files from SharePoint Active Projects."""
    print("☁️  Fetching SharePoint data...")
    
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    
    drive_id = get_active_projects_drive_id(site_id, access_token)
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    # Get all folders
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children"
    sp_data = {}
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    folders = [item for item in response.json().get("value", []) if item.get("folder")]
    print(f"   Found {len(folders)} folders, scanning contents...")
    
    for i, folder in enumerate(folders):
        folder_name = folder["name"]
        files_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{folder['id']}/children"
        
        try:
            files_response = requests.get(files_url, headers=headers)
            files_response.raise_for_status()
            
            files = [f["name"] for f in files_response.json().get("value", []) if not f.get("folder")]
            sp_data[folder_name] = files
        except Exception as e:
            sp_data[folder_name] = []
        
        time.sleep(0.1)  # Rate limit
        
        if (i + 1) % 50 == 0:
            print(f"   Scanned {i + 1}/{len(folders)} folders...")
    
    return sp_data, drive_id, access_token


def main():
    config = Config()
    
    print("\n" + "=" * 70)
    print("🔍 DRY RUN: Compare Monday Language Profiles vs SharePoint")
    print("=" * 70)
    
    # Step 1: Get Monday data
    monday_profiles = get_all_monday_profiles(config)
    print(f"   ✓ Found {len(monday_profiles)} projects with Language Profile files in Monday\n")
    
    # Step 2: Get SharePoint data
    sp_files, drive_id, access_token = get_sharepoint_files(config)
    print(f"   ✓ Found {len(sp_files)} folders in SharePoint\n")
    
    # Step 3: Compare
    print("🔄 Comparing...\n")
    
    missing = []
    existing = []
    
    for profile in monday_profiles:
        folder_name = profile["folder_name"]
        file_name = profile["file_name"]
        
        if folder_name in sp_files:
            if file_name in sp_files[folder_name]:
                existing.append(profile)
            else:
                missing.append({**profile, "folder_exists": True})
        else:
            missing.append({**profile, "folder_exists": False})
    
    # Step 4: Display results
    print("=" * 70)
    print(f"📊 COMPARISON RESULTS")
    print("=" * 70)
    
    print(f"\n✅ Already in SharePoint: {len(existing)} files")
    print(f"❌ Missing from SharePoint: {len(missing)} files\n")
    
    if missing:
        print("-" * 70)
        print("FILES TO BE UPLOADED:")
        print("-" * 70)
        
        # Group by whether folder exists
        new_folders = [m for m in missing if not m["folder_exists"]]
        existing_folders = [m for m in missing if m["folder_exists"]]
        
        if new_folders:
            print(f"\n📁 NEW FOLDERS TO CREATE ({len(new_folders)}):\n")
            for m in sorted(new_folders, key=lambda x: x["folder_name"]):
                print(f"  {m['folder_name']}/")
                print(f"    └─ {m['file_name']}")
                if m["mou_end_date"]:
                    print(f"       MOU End: {m['mou_end_date']}")
        
        if existing_folders:
            print(f"\n📄 FILES TO ADD TO EXISTING FOLDERS ({len(existing_folders)}):\n")
            for m in sorted(existing_folders, key=lambda x: x["folder_name"]):
                print(f"  {m['folder_name']}/")
                print(f"    └─ {m['file_name']}")
    
    print("\n" + "=" * 70)
    print(f"📋 SUMMARY")
    print("=" * 70)
    print(f"   Monday profiles:        {len(monday_profiles)}")
    print(f"   SharePoint folders:     {len(sp_files)}")
    print(f"   Already synced:         {len(existing)}")
    print(f"   Missing (to upload):    {len(missing)}")
    if missing:
        new_count = len([m for m in missing if not m["folder_exists"]])
        add_count = len([m for m in missing if m["folder_exists"]])
        print(f"     - New folders:        {new_count}")
        print(f"     - Add to existing:    {add_count}")
    print("=" * 70)
    
    if missing:
        print("\n⚠️  This is a DRY RUN - no files were uploaded.")
        print("Run 'python sync_missing_profiles.py' to upload these files.\n")
    else:
        print("\n✅ All Monday Language Profiles are already in SharePoint!\n")
    
    return missing


if __name__ == "__main__":
    main()
