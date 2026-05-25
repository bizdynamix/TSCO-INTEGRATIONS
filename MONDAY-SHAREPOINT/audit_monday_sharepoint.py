#!/usr/bin/env python3
"""
Audit script: Compare Monday board items with SharePoint Active Projects
Shows which projects have Language Profiles in Monday vs what exists in SharePoint
"""

import requests
from monday_to_sharepoint_drytest_onefile import (
    Config,
    get_board_items_with_files,
    resolve_column_ids,
    get_graph_access_token,
    get_sharepoint_site_id,
    get_site_drive_id,
)
import os
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple
import json

# Import from main script
sys.path.insert(0, str(Path(__file__).parent))


def get_all_items_with_files(
    items: List[Dict], file_col_id: str, project_col_id: str, mou_col_id: str
) -> List[Tuple[str, str, int, str]]:
    """Extract all items that have project name and files.

    Returns: List of (project_name, item_name, file_count, mou_end_date)
    """
    results = []

    for item in items:
        project_name = None
        mou_end_date = None
        file_count = 0

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
                            file_count = len(file_data["files"])
                    except json.JSONDecodeError:
                        pass

        # Count assets as backup
        if file_count == 0 and item.get("assets"):
            file_count = len(item["assets"])

        if project_name and project_name.strip() and file_count > 0:
            results.append(
                (project_name.strip(), item["name"], file_count, mou_end_date)
            )

    return results


def get_active_projects_drive_id(site_id: str, access_token: str) -> str:
    """Get the drive ID for 'Active Projects' document library."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # List all drives (document libraries) on the site
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
    response = requests.get(url, headers=headers)
    response.raise_for_status()

    drives = response.json().get("value", [])

    # Find "Active Projects" library
    for drive in drives:
        if drive.get("name") == "Active Projects":
            return drive["id"]

    # Fallback to default drive if not found
    return drives[0]["id"] if drives else None


def get_sharepoint_project_folders(
        drive_id: str, access_token: str) -> Dict[str, Dict]:
    """Get all folders in SharePoint Active Projects/Projects.

    Returns: Dict of {folder_name: {file_count, has_profile, files: [...]}}
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Get Projects folder
    projects_path = "Projects"
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{projects_path}:/children"

    response = requests.get(url, headers=headers)

    if response.status_code == 404:
        print("   ⚠️  Projects folder not found in SharePoint")
        return {}

    response.raise_for_status()
    data = response.json()

    folders = {}

    for item in data.get("value", []):
        if item.get("folder"):  # Is a folder
            folder_name = item["name"]

            # Skip test folder
            if folder_name.startswith("_TEST"):
                continue

            # Get files in this folder
            folder_id = item["id"]
            files_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{folder_id}/children"
            files_resp = requests.get(files_url, headers=headers)

            if files_resp.status_code == 200:
                files_data = files_resp.json()
                files_list = []
                has_profile = False

                for file_item in files_data.get("value", []):
                    if file_item.get("file"):  # Is a file, not subfolder
                        file_name = file_item["name"]
                        files_list.append(file_name)

                        # Check if it looks like a Language Profile
                        if (
                            "profile" in file_name.lower()
                            or "language" in file_name.lower()
                        ):
                            has_profile = True

                folders[folder_name] = {
                    "file_count": len(files_list),
                    "has_profile": has_profile,
                    "files": files_list,
                }
            else:
                folders[folder_name] = {
                    "file_count": 0,
                    "has_profile": False,
                    "files": [],
                }

    return folders


def main():
    print("=" * 70)
    print("📊 MONDAY ↔ SHAREPOINT AUDIT")
    print("=" * 70)

    # Load config
    config = Config()
    config.validate()
    print(f"\n✓ Configuration loaded")

    # Step 1: Get Monday data
    print(f"\n📥 Step 1: Fetching Monday board data...")

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

    monday_projects = get_all_items_with_files(
        items, file_col_id, project_col_id, mou_col_id
    )
    print(
        f"   ✓ Found {
            len(monday_projects)} items with Language Profile files")

    # Step 2: Get SharePoint data
    print(f"\n☁️  Step 2: Fetching SharePoint Active Projects data...")
    print(f"   (This may take a minute to scan all project folders...)")

    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    print(f"   ✓ Authenticated")

    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    print(f"   ✓ Site resolved")

    drive_id = get_active_projects_drive_id(site_id, access_token)
    print(f"   ✓ Drive ID obtained, scanning folders...")

    sp_folders = get_sharepoint_project_folders(drive_id, access_token)
    print(f"   ✓ Found {len(sp_folders)} project folders in SharePoint")

    # Step 3: Compare and categorize
    print(f"\n🔍 Step 3: Analyzing differences...")

    monday_project_names = set(proj[0] for proj in monday_projects)
    sp_project_names = set(sp_folders.keys())

    # Category 1: In Monday with files, but no folder in SharePoint
    needs_folder = monday_project_names - sp_project_names

    # Category 2: Folder exists but no Language Profile file
    needs_file = set()
    for proj_name in monday_project_names & sp_project_names:
        if not sp_folders[proj_name]["has_profile"]:
            needs_file.add(proj_name)

    # Category 3: Folder exists with Language Profile
    has_both = set()
    for proj_name in monday_project_names & sp_project_names:
        if sp_folders[proj_name]["has_profile"]:
            has_both.add(proj_name)

    # Category 4: In SharePoint but not in Monday (orphaned)
    orphaned = sp_project_names - monday_project_names

    # Print report
    print("\n" + "=" * 70)
    print("📊 AUDIT REPORT")
    print("=" * 70)

    print(f"\n✅ ALREADY COMPLETE ({len(has_both)} projects)")
    print(
        "   These folders exist in SharePoint and already have Language Profile files:"
    )
    for proj_name in sorted(has_both):
        files = sp_folders[proj_name]["files"]
        profile_files = [
            f for f in files if "profile" in f.lower() or "language" in f.lower()]
        print(f"   • {proj_name}")
        for pf in profile_files:
            print(f"     - {pf}")

    print(f"\n📁 NEEDS FOLDER CREATION ({len(needs_folder)} projects)")
    print("   These projects have files in Monday but no folder in SharePoint:")
    for proj_name in sorted(needs_folder):
        # Find the Monday item details
        monday_item = next(
            (p for p in monday_projects if p[0] == proj_name), None)
        if monday_item:
            _, item_name, file_count, mou = monday_item
            mou_str = f" [MOU End: {mou}]" if mou else ""
            print(f"   • {proj_name} ({file_count} file(s)){mou_str}")

    print(f"\n📄 NEEDS FILE UPLOAD ({len(needs_file)} projects)")
    print("   These folders exist but don't have Language Profile files:")
    for proj_name in sorted(needs_file):
        existing = sp_folders[proj_name]["file_count"]
        print(f"   • {proj_name} (has {existing} other file(s))")

    if orphaned:
        print(f"\n⚠️  ORPHANED FOLDERS ({len(orphaned)} projects)")
        print("   These folders exist in SharePoint but have no matching Monday item:")
        for proj_name in sorted(orphaned):
            file_count = sp_folders[proj_name]["file_count"]
            print(f"   • {proj_name} ({file_count} file(s))")

    # Summary
    print("\n" + "=" * 70)
    print("📈 SUMMARY")
    print("=" * 70)
    print(f"   Total Monday projects with files:  {len(monday_project_names)}")
    print(f"   Total SharePoint project folders:  {len(sp_project_names)}")
    print(f"")
    print(f"   ✅ Already complete:                {len(has_both)}")
    print(f"   📁 Need folder creation:            {len(needs_folder)}")
    print(f"   📄 Need file upload:                {len(needs_file)}")
    print(f"   ⚠️  Orphaned (no Monday match):     {len(orphaned)}")
    print("=" * 70)

    total_actions = len(needs_folder) + len(needs_file)
    print(f"\n💡 Migration will affect {total_actions} projects")
    print(f"   ({len(needs_folder)} new folders + {len(needs_file)} file uploads)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
