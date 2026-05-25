#!/usr/bin/env python3
"""
Sync missing Language Profile files from Monday.com to SharePoint
Only processes ACTIVE projects with valid Language Profile files
"""

import os
import sys
import json
import time
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import (
    Config, resolve_column_ids, get_graph_access_token, get_sharepoint_site_id, download_file
)
from bulk_migrate_all import get_active_projects_drive_id, ensure_folder_exists, set_folder_metadata
import requests
from urllib.parse import quote


def get_all_monday_profiles(config):
    """Get all ACTIVE items from Monday with Language Profile files."""
    print("📥 Fetching Monday.com board data...")
    
    column_map = resolve_column_ids(
        config.monday_board_id,
        config.monday_api_token,
        [config.column_title_files, config.column_title_project, config.column_title_mou_end_date]
    )
    
    file_col_id = column_map[config.column_title_files]
    project_col_id = column_map[config.column_title_project]
    mou_col_id = column_map[config.column_title_mou_end_date]
    lang_status_col_id = "status"
    
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
    missing_assets = []
    no_file_column = []
    
    for item in items:
        project_name = None
        mou_end_date = None
        file_info = None
        file_asset = None
        lang_status = None
        has_file_in_column = False
        file_asset_id = None
        
        for col in item.get("column_values", []):
            if col["id"] == project_col_id:
                project_name = col.get("text", "")
            elif col["id"] == mou_col_id:
                mou_end_date = col.get("text")
            elif col["id"] == lang_status_col_id:
                lang_status = col.get("text", "").strip().upper()
            elif col["id"] == file_col_id:
                if col.get("value"):
                    has_file_in_column = True
                    try:
                        file_data = json.loads(col["value"])
                        if "files" in file_data and file_data["files"]:
                            file_info = file_data["files"][0]
                            file_asset_id = file_info.get("assetId")
                            
                            for asset in item.get("assets", []):
                                if str(asset["id"]) == str(file_asset_id):
                                    file_asset = asset
                                    break
                    except json.JSONDecodeError:
                        pass
        
        if lang_status != "ACTIVE":
            continue
        
        if has_file_in_column and not file_asset:
            missing_assets.append({
                "item_name": item["name"],
                "item_id": item["id"],
                "project_name": project_name,
                "asset_id": file_asset_id,
                "available_assets": [a["name"] for a in item.get("assets", [])][:3]
            })
            continue
        
        if not has_file_in_column:
            no_file_column.append({
                "item_name": item["name"],
                "item_id": item["id"],
                "project_name": project_name
            })
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
    
    return profiles, missing_assets, no_file_column


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
        except:
            sp_data[folder_name] = []
        
        time.sleep(0.1)
        if (i + 1) % 50 == 0:
            print(f"   Scanned {i + 1}/{len(folders)} folders...")
    
    return sp_data, drive_id, site_id, access_token


def upload_file_to_sharepoint(drive_id, folder_path, file_path, access_token):
    """Upload a file to SharePoint."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream"
    }
    
    file_name = Path(file_path).name
    encoded_path = quote(f"{folder_path}/{file_name}")
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}:/content"
    
    with open(file_path, "rb") as f:
        response = requests.put(url, headers=headers, data=f)
    
    response.raise_for_status()
    return response.json()


def main():
    config = Config()
    start_time = datetime.now()
    
    print("\n" + "=" * 70)
    print("🚀 SYNC: Upload missing Language Profiles to SharePoint")
    print("=" * 70)
    
    # Step 1: Get Monday data
    monday_profiles, missing_assets, no_file_column = get_all_monday_profiles(config)
    print(f"   ✓ Found {len(monday_profiles)} ACTIVE projects with valid Language Profile files")
    print(f"   ⚠️  {len(missing_assets)} ACTIVE with file column but missing asset")
    print(f"   ⚠️  {len(no_file_column)} ACTIVE with no file in Language Profile column")
    
    # Step 2: Get SharePoint data
    sp_files, drive_id, site_id, access_token = get_sharepoint_files(config)
    print(f"   ✓ Found {len(sp_files)} folders in SharePoint\n")
    
    # Step 3: Find missing files
    missing = []
    for profile in monday_profiles:
        folder_name = profile["folder_name"]
        file_name = profile["file_name"]
        
        if folder_name in sp_files:
            if file_name not in sp_files[folder_name]:
                missing.append({**profile, "folder_exists": True})
        else:
            missing.append({**profile, "folder_exists": False})
    
    print(f"📤 Found {len(missing)} files to upload\n")
    
    if not missing:
        print("✅ All files are already synced!")
        return
    
    # Step 4: Upload missing files
    stats = {
        "uploaded": 0,
        "folders_created": 0,
        "metadata_set": 0,
        "errors": 0,
        "error_details": []
    }
    
    download_dir = Path("./downloads/_sync")
    download_dir.mkdir(parents=True, exist_ok=True)
    
    for idx, profile in enumerate(missing, 1):
        print(f"[{idx}/{len(missing)}] {profile['folder_name']}")
        
        try:
            # Download file from Monday
            local_dir = download_dir / profile["folder_name"]
            local_dir.mkdir(parents=True, exist_ok=True)
            local_file = local_dir / profile["file_name"]
            
            if not local_file.exists():
                print(f"   📥 Downloading {profile['file_name']}...")
                download_file(profile["file_url"], local_file, force=False)
                time.sleep(0.3)
            
            # Create folder if needed
            if not profile["folder_exists"]:
                print(f"   📁 Creating folder...")
                ensure_folder_exists(drive_id, profile["folder_name"], access_token)
                stats["folders_created"] += 1
                time.sleep(0.5)
                
                # Set MOU metadata
                if profile.get("mou_end_date"):
                    try:
                        set_folder_metadata(
                            site_id, drive_id, profile["folder_name"],
                            {"MOUenddate0": profile["mou_end_date"]},
                            access_token
                        )
                        stats["metadata_set"] += 1
                    except Exception as e:
                        print(f"   ⚠️  Metadata error: {e}")
                    time.sleep(0.3)
            
            # Upload file
            print(f"   📤 Uploading {profile['file_name']}...")
            upload_file_to_sharepoint(drive_id, profile["folder_name"], local_file, access_token)
            stats["uploaded"] += 1
            print(f"   ✓ Done")
            time.sleep(0.5)
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            stats["errors"] += 1
            stats["error_details"].append({
                "folder": profile["folder_name"],
                "file": profile["file_name"],
                "error": str(e)
            })
            time.sleep(1)
    
    # Step 5: Generate report
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    print("\n" + "=" * 70)
    print("📊 SYNC COMPLETE")
    print("=" * 70)
    print(f"   Files uploaded:     {stats['uploaded']}")
    print(f"   Folders created:    {stats['folders_created']}")
    print(f"   MOU dates set:      {stats['metadata_set']}")
    print(f"   Errors:             {stats['errors']}")
    print(f"   Duration:           {duration:.1f} seconds")
    print("=" * 70)
    
    # Write report
    report_path = Path("./SYNC_REPORT.md")
    with open(report_path, "w") as f:
        f.write("# Monday.com to SharePoint Sync Report\n\n")
        f.write(f"**Date**: {datetime.now().strftime('%B %d, %Y at %H:%M')}\n\n")
        f.write("---\n\n")
        
        f.write("## Summary\n\n")
        f.write("| Metric | Count |\n")
        f.write("|--------|-------|\n")
        f.write(f"| Files Uploaded | {stats['uploaded']} |\n")
        f.write(f"| Folders Created | {stats['folders_created']} |\n")
        f.write(f"| MOU Dates Set | {stats['metadata_set']} |\n")
        f.write(f"| Errors | {stats['errors']} |\n")
        f.write(f"| Duration | {duration:.1f}s |\n\n")
        
        f.write("## Monday.com Data Analysis\n\n")
        f.write("| Category | Count |\n")
        f.write("|----------|-------|\n")
        f.write(f"| ACTIVE with valid Language Profile | {len(monday_profiles)} |\n")
        f.write(f"| ACTIVE with file column but missing asset | {len(missing_assets)} |\n")
        f.write(f"| ACTIVE with no file in column | {len(no_file_column)} |\n\n")
        
        if missing_assets:
            f.write("## ⚠️ ACTIVE Projects with Missing File Assets\n\n")
            f.write("These items have a file reference in the Language Profile column, but the file asset cannot be accessed:\n\n")
            f.write("| Item Name | Project Name | Item ID | Available Assets |\n")
            f.write("|-----------|--------------|---------|------------------|\n")
            for item in missing_assets:
                assets = ", ".join(item["available_assets"][:2]) if item["available_assets"] else "None"
                f.write(f"| {item['item_name']} | {item['project_name']} | {item['item_id']} | {assets} |\n")
            f.write("\n")
        
        if stats["error_details"]:
            f.write("## ❌ Upload Errors\n\n")
            f.write("| Folder | File | Error |\n")
            f.write("|--------|------|-------|\n")
            for err in stats["error_details"]:
                f.write(f"| {err['folder']} | {err['file']} | {err['error'][:50]}... |\n")
            f.write("\n")
        
        f.write("## Next Steps\n\n")
        f.write("1. Review the 'Missing File Assets' table above and re-upload those files in Monday.com\n")
        f.write("2. Check any upload errors and retry if needed\n")
        f.write("3. Verify files in SharePoint Active Projects site\n")
    
    print(f"\n📄 Report saved to: {report_path}")


if __name__ == "__main__":
    main()
