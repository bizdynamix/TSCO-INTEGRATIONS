#!/usr/bin/env python3
"""
Dry run: Check which Language Profile files from Monday are missing in SharePoint
Lists all files that would be uploaded without actually uploading
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv(Path(__file__).parent / ".env")

sys.path.insert(0, str(Path(__file__).parent))

from bulk_migrate_all import (
    Config,
    resolve_column_ids,
    get_board_items_with_files,
    get_all_items_with_files,
    get_active_projects_drive_id,
    file_exists_in_sharepoint,
)
from monday_to_sharepoint_drytest_onefile import (
    get_graph_access_token,
    get_sharepoint_site_id,
)
import json
import time

def get_sharepoint_project_folders(drive_id: str, access_token: str) -> set:
    """Get list of all project folders in SharePoint Active Projects."""
    import requests
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    
    url = f"https://graph.microsoft.com/v1.0/me/drive/items/{drive_id}/children"
    folders = set()
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        for item in response.json().get("value", []):
            if item.get("folder"):
                folders.add(item["name"])
    except Exception as e:
        print(f"⚠️  Error getting SharePoint folders: {e}")
    
    return folders

def main():
    config = Config()
    
    print("\n🔍 DRY RUN: Checking missing Language Profile files\n")
    print("=" * 70)
    
    # Step 1: Get Monday data
    print("\n📥 Step 1: Fetching Monday.com board data...")
    
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
    
    items = get_board_items_with_files(
        config.monday_board_id,
        [file_col_id, project_col_id, mou_col_id],
        config.monday_api_token,
    )
    
    all_projects = get_all_items_with_files(
        items, file_col_id, project_col_id, mou_col_id
    )
    print(f"   ✓ Found {len(all_projects)} projects with Language Profile files on Monday")
    
    # Step 2: Authenticate with SharePoint
    print(f"\n☁️  Step 2: Authenticating with SharePoint...")
    
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    
    drive_id = get_active_projects_drive_id(site_id, access_token)
    print(f"   ✓ Connected to SharePoint")
    
    # Step 3: Get existing SharePoint folders
    print(f"\n📂 Step 3: Scanning existing SharePoint folders...")
    sp_folders = get_sharepoint_project_folders(drive_id, access_token)
    print(f"   ✓ Found {len(sp_folders)} project folders in SharePoint")
    
    # Step 4: Check which files are missing
    print(f"\n📋 Step 4: Checking for missing files...\n")
    
    missing_files = []
    
    for idx, (item, project_name, file_asset, mou_end_date) in enumerate(all_projects, 1):
        folder_name = project_name.upper()
        file_exists = file_exists_in_sharepoint(
            drive_id, folder_name, file_asset["name"], access_token
        )
        time.sleep(0.2)  # Rate limit
        
        if not file_exists:
            # Check if folder exists
            folder_exists = folder_name in sp_folders
            missing_files.append({
                'project': project_name,
                'folder_name': folder_name,
                'file_name': file_asset["name"],
                'folder_exists': folder_exists,
                'mou_end_date': mou_end_date
            })
    
    # Step 5: Display results
    print("=" * 70)
    print(f"📊 RESULTS: {len(missing_files)} files would be uploaded\n")
    
    if missing_files:
        print("Files to be uploaded:")
        print("-" * 70)
        
        # Group by folder
        by_folder = {}
        for file_info in missing_files:
            folder = file_info['folder_name']
            if folder not in by_folder:
                by_folder[folder] = []
            by_folder[folder].append(file_info)
        
        for folder in sorted(by_folder.keys()):
            files = by_folder[folder]
            status = "📁 (new folder)" if not files[0]['folder_exists'] else "✓ (folder exists)"
            print(f"\n{folder} {status}")
            for file_info in files:
                print(f"  └─ {file_info['file_name']}")
                if file_info['mou_end_date']:
                    print(f"     MOU End: {file_info['mou_end_date']}")
    else:
        print("✅ All Language Profile files from Monday are already in SharePoint!")
    
    print("\n" + "=" * 70)
    print(f"\n📊 Summary:")
    print(f"   Monday profiles: {len(all_projects)}")
    print(f"   SharePoint folders: {len(sp_folders)}")
    print(f"   Missing files: {len(missing_files)}")
    print(f"\nRun 'python sync_missing_profiles.py' to upload these files\n")

if __name__ == "__main__":
    main()
