#!/usr/bin/env python3
"""
Check SharePoint columns in Active Projects site
"""

from monday_to_sharepoint_drytest_onefile import (
    Config,
    get_graph_access_token,
    get_sharepoint_site_id,
)
import os
import sys
import requests
from pathlib import Path

# Add parent directory to path to import Config
sys.path.insert(0, str(Path(__file__).parent))


def main():
    print("=" * 70)
    print("CHECKING SHAREPOINT COLUMNS")
    print("=" * 70)

    # Load config
    config = Config()

    # Override with actual values if placeholders exist
    if config.tenant_id == "your_tenant_id_here" or not config.tenant_id:
        config.tenant_id = "1f77873f-c089-436e-b8e7-e48c95f13ede"

    config.validate()

    print(f"\n✓ Configuration loaded")
    print(
        f"  • SharePoint Site: {
            config.sharepoint_hostname}{
            config.sharepoint_site_path}")

    # Authenticate
    print(f"\n🔐 Authenticating with Microsoft Graph...")
    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )
    print(f"✓ Access token obtained")

    # Get site ID
    print(f"\n📍 Resolving SharePoint site...")
    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )
    print(f"✓ Site ID: {site_id}")

    # Get lists
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    print(f"\n📚 Getting document libraries...")
    lists_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists"
    lists_response = requests.get(lists_url, headers=headers)
    lists_response.raise_for_status()
    lists_data = lists_response.json()

    # Find Documents library
    documents_list = None
    print(f"  Available libraries:")
    for list_item in lists_data.get("value", []):
        list_name = list_item.get(
            "displayName", list_item.get(
                "name", "Unknown"))
        print(f"    • {list_name}")
        if (
            list_item.get("displayName") == "Documents"
            or list_item.get("name") == "Documents"
        ):
            documents_list = list_item

    # Try alternative names if Documents not found
    if not documents_list:
        for list_item in lists_data.get("value", []):
            list_name = list_item.get("displayName", "").lower()
            if ("document" in list_name or list_item.get(
                    "list", {}).get("template") == "documentLibrary"):
                documents_list = list_item
                break

    if not documents_list:
        print("❌ Could not find Documents library")
        return 1

    list_id = documents_list["id"]
    print(f"✓ Found: {documents_list['displayName']}")

    # Get columns
    print(f"\n🔍 Checking for MOU End Date column...")
    columns_url = (
        f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/columns")
    columns_response = requests.get(columns_url, headers=headers)
    columns_response.raise_for_status()
    columns_data = columns_response.json()

    print("-" * 70)

    # Look for MOU-related columns
    mou_columns = []
    all_date_columns = []

    for col in columns_data.get("value", []):
        display_name = col.get("displayName", "")

        # Check for MOU-related
        if "MOU" in display_name.upper():
            mou_columns.append(col)
            print(f"\n✓ MOU Column Found: '{display_name}'")
            print(f"  Internal Name: {col.get('name')}")
            print(f"  Column Group: {col.get('columnGroup')}")
            print(f"  Hidden: {col.get('hidden')}")
            if "dateTime" in col:
                print(
                    f"  Date Format: {
                        col.get(
                            'dateTime',
                            {}).get('format')}")

        # Track all date columns (non-hidden)
        if "dateTime" in col and not col.get("hidden"):
            all_date_columns.append((display_name, col.get("name")))

    print("\n" + "=" * 70)

    if mou_columns:
        print(f"✅ SUCCESS: Found {len(mou_columns)} MOU-related column(s)")
        for col in mou_columns:
            print(f"   • {col.get('displayName')}")
    else:
        print("⚠️  WARNING: No 'MOU End Date' column found in SharePoint")
        print("\nAvailable date columns:")
        for name, internal_name in all_date_columns[:10]:
            print(f"  • {name} ({internal_name})")

        print("\n💡 Action Required:")
        print("   Create an 'MOU End Date' column in SharePoint")
        print("   Or update the script to use an existing date column")

    print("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
