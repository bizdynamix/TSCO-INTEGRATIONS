#!/usr/bin/env python3
"""
Rename Western Krahn folder to WESTERN KRAHN
"""

import requests
from monday_to_sharepoint_drytest_onefile import (
    Config,
    get_graph_access_token,
    get_sharepoint_site_id,
)
import sys
from pathlib import Path

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


def rename_folder(
        drive_id: str,
        old_name: str,
        new_name: str,
        access_token: str):
    """Rename a folder by getting its item and patching."""
    from urllib.parse import quote

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Get folder item
    encoded_path = quote(old_name)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"

    resp = requests.get(url, headers=headers)

    if resp.status_code == 404:
        print(f"   ℹ️  Folder '{old_name}' not found, may already be renamed")
        return False

    resp.raise_for_status()
    item = resp.json()
    item_id = item["id"]

    # Rename via PATCH
    patch_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}"
    patch_resp = requests.patch(
        patch_url, json={
            "name": new_name}, headers=headers)
    patch_resp.raise_for_status()

    return True


def main():
    print("=" * 70)
    print("🔤 RENAME WESTERN KRAHN → WESTERN KRAHN")
    print("=" * 70)

    config = Config()
    config.validate()

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
    print(f"✓ Drive ID obtained")

    print(f"\n🔄 Renaming folder...")
    success = rename_folder(
        drive_id,
        "Western Krahn",
        "WESTERN KRAHN",
        access_token)

    if success:
        print(f"✓ Renamed to WESTERN KRAHN")

    print("\n" + "=" * 70)
    print("✅ COMPLETE")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
