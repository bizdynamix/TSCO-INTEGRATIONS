#!/usr/bin/env python3
"""
Check and update MOU End Date for Western Krahn folder
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
import time

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


def get_folder_metadata(drive_id: str, folder_name: str, access_token: str):
    """Get metadata for a folder."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    encoded_path = quote(folder_name)
    item_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")

    item_resp = requests.get(item_url, headers=headers)
    item_resp.raise_for_status()
    item = item_resp.json()
    item_id = item["id"]

    # Get list item with fields
    li_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/listItem?expand=fields"
    li_resp = requests.get(li_url, headers=headers)
    li_resp.raise_for_status()

    return li_resp.json()


def set_folder_metadata(
        site_id: str,
        drive_id: str,
        folder_name: str,
        fields: dict,
        access_token: str):
    """Set metadata on a folder."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    encoded_path = quote(folder_name)
    item_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")

    # Add small delay to ensure folder is ready
    time.sleep(1)

    item_resp = requests.get(item_url, headers=headers)
    item_resp.raise_for_status()
    item = item_resp.json()
    item_id = item["id"]

    # Get list item
    li_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/listItem"
    )
    li_resp = requests.get(li_url, headers=headers)
    li_resp.raise_for_status()
    li_data = li_resp.json()

    print(f"   • List item data keys: {list(li_data.keys())}")

    list_item_id = li_data["id"]

    # Try multiple ways to get list ID
    list_id = None
    if "parentReference" in li_data and "sharepointIds" in li_data["parentReference"]:
        list_id = li_data["parentReference"]["sharepointIds"].get("listId")

    if not list_id and "sharepointIds" in li_data:
        list_id = li_data["sharepointIds"].get("listId")

    if not list_id:
        # Get it from the site/lists endpoint
        lists_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists"
        lists_resp = requests.get(lists_url, headers=headers)
        lists_resp.raise_for_status()
        lists = lists_resp.json().get("value", [])

        # Find Active Projects list
        for lst in lists:
            if (
                lst.get("displayName") == "Active Projects"
                or lst.get("name") == "Active Projects"
            ):
                list_id = lst["id"]
                break

    if not list_id:
        print(f"   • Available data: {li_data}")
        raise Exception("Could not get list ID")

    # Update fields
    patch_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{list_item_id}/fields"
    patch_resp = requests.patch(patch_url, json=fields, headers=headers)
    patch_resp.raise_for_status()

    return patch_resp.json()


def main():
    print("=" * 70)
    print("📅 CHECK/SET MOU END DATE FOR WESTERN KRAHN")
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

    folder_name = "WESTERN KRAHN"

    print(f"\n📂 Checking current metadata for '{folder_name}'...")
    metadata = get_folder_metadata(drive_id, folder_name, access_token)

    fields = metadata.get("fields", {})
    current_mou = fields.get("MOUenddate0")

    if current_mou:
        print(f"   ✓ Current MOU End Date: {current_mou}")
    else:
        print(f"   ⚠️  MOU End Date not set")

    print(f"\n📝 Setting MOU End Date to 2028-09-30...")
    updated = set_folder_metadata(
        site_id, drive_id, folder_name, {
            "MOUenddate0": "2028-09-30"}, access_token)

    new_mou = updated.get("MOUenddate0")
    print(f"   ✓ Updated MOU End Date: {new_mou}")

    print("\n" + "=" * 70)
    print("✅ COMPLETE")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
