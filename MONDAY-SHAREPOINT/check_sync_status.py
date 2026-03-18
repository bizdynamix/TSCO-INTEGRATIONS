#!/usr/bin/env python3
"""
Quick check: Compare local downloads folder with SharePoint folders
Shows what's missing without querying Monday API
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv(Path(__file__).parent / ".env")

sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import (
    get_graph_access_token,
    get_sharepoint_site_id,
)
from bulk_migrate_all import get_active_projects_drive_id
import requests

def get_sharepoint_folders(drive_id: str, access_token: str) -> dict:
    """Get all project folders in SharePoint Active Projects."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children"
    folders = {}
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    for item in response.json().get("value", []):
        if item.get("folder"):
            folder_name = item["name"]
            folders[folder_name] = {
                "id": item["id"],
                "files": []
            }
            
            # Get files in this folder
            files_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item['id']}/children"
            files_response = requests.get(files_url, headers=headers)
            files_response.raise_for_status()
            
            for file_item in files_response.json().get("value", []):
                if not file_item.get("folder"):
                    folders[folder_name]["files"].append(file_item["name"])
    
    return folders

def main():
    print("\n🔍 Quick Check: Local vs SharePoint\n")
    print("=" * 70)
    
    # Step 1: Get local downloads
    print("\n📂 Step 1: Scanning local downloads folder...")
    local_dir = Path("./downloads/_bulk")
    local_folders = {}
    
    for folder in sorted(local_dir.iterdir()):
        if folder.is_dir():
            files = [f.name for f in folder.iterdir() if f.is_file()]
            local_folders[folder.name] = files
    
    print(f"   ✓ Found {len(local_folders)} local folders with {sum(len(f) for f in local_folders.values())} files")
    
    # Step 2: Get SharePoint folders
    print(f"\n☁️  Step 2: Fetching SharePoint folders...")
    
    from bulk_migrate_all import Config
    config = Config()
    
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    
    drive_id = get_active_projects_drive_id(site_id, access_token)
    sp_folders = get_sharepoint_folders(drive_id, access_token)
    
    print(f"   ✓ Found {len(sp_folders)} SharePoint folders")
    
    # Step 3: Compare
    print(f"\n🔄 Step 3: Comparing...\n")
    
    missing = []
    for local_folder, local_files in sorted(local_folders.items()):
        sp_folder = local_folder.upper()
        
        if sp_folder not in sp_folders:
            missing.append((local_folder, "folder missing", len(local_files)))
        else:
            sp_files = sp_folders[sp_folder]["files"]
            missing_files = [f for f in local_files if f not in sp_files]
            
            if missing_files:
                for mf in missing_files:
                    missing.append((local_folder, mf, None))
    
    # Display results
    print("=" * 70)
    if missing:
        print(f"⚠️  {len(missing)} items would be uploaded:\n")
        
        current_folder = None
        for item_folder, item_detail, file_count in missing:
            if item_folder != current_folder:
                current_folder = item_folder
                if item_detail == "folder missing":
                    print(f"\n📁 {item_folder.upper()} (NEW FOLDER - {file_count} files)")
                else:
                    print(f"\n📁 {item_folder.upper()}")
            
            if item_detail != "folder missing":
                print(f"   └─ {item_detail}")
    else:
        print("✅ Everything is synced!")
    
    print("\n" + "=" * 70)
    print(f"\n📊 Summary:")
    print(f"   Local folders: {len(local_folders)}")
    print(f"   SharePoint folders: {len(sp_folders)}")
    print(f"   Items to update: {len(missing)}")
    print("\nRun 'python sync_missing_profiles.py' to upload missing files\n")

if __name__ == "__main__":
    main()
