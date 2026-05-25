#!/usr/bin/env python3
"""
Rename all project folders to UPPERCASE in SharePoint Active Projects
"""

import requests
from monday_to_sharepoint_drytest_onefile import (
    Config,
    get_graph_access_token,
    get_sharepoint_site_id,
)
import sys
from pathlib import Path
from urllib.parse import quote

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


def get_all_folders(drive_id: str, access_token: str):
    """Get all top-level folders in Active Projects."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children"
    response = requests.get(url, headers=headers)
    response.raise_for_status()

    items = response.json().get("value", [])
    folders = [item for item in items if item.get("folder")]

    return folders


def rename_folder(
        drive_id: str,
        item_id: str,
        old_name: str,
        new_name: str,
        access_token: str) -> bool:
    """Rename a folder."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}"

    data = {"name": new_name}

    response = requests.patch(url, json=data, headers=headers)

    if response.status_code == 200:
        return True
    else:
        print(f"      Error: {response.status_code} - {response.text}")
        return False


def main():
    print("=" * 70)
    print("🔤 RENAME FOLDERS TO UPPERCASE")
    print("=" * 70)

    config = Config()
    config.validate()
    print(f"\n✓ Configuration loaded")

    print(f"\n🔐 Authenticating...")
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    print(f"✓ Authenticated")

    print(f"\n📍 Resolving SharePoint site...")
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    print(f"✓ Site resolved")

    print(f"\n📚 Getting Active Projects drive...")
    drive_id = get_active_projects_drive_id(site_id, access_token)
    print(f"✓ Drive ID: {drive_id}")

    print(f"\n📁 Getting all folders...")
    folders = get_all_folders(drive_id, access_token)
    print(f"✓ Found {len(folders)} folders")

    print(f"\n🔄 Renaming folders to UPPERCASE...")

    renamed_count = 0
    skipped_count = 0

    for folder in folders:
        old_name = folder["name"]
        new_name = old_name.upper()

        if old_name == new_name:
            print(f"   ⏭️  {old_name} (already uppercase)")
            skipped_count += 1
            continue

        print(f"   • {old_name} → {new_name}")

        success = rename_folder(
            drive_id, folder["id"], old_name, new_name, access_token
        )

        if success:
            print(f"      ✓ Renamed")
            renamed_count += 1
        else:
            print(f"      ✗ Failed")

    print("\n" + "=" * 70)
    print("📊 SUMMARY")
    print("=" * 70)
    print(f"   Renamed: {renamed_count}")
    print(f"   Skipped: {skipped_count}")
    print(f"   Total:   {len(folders)}")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
