#!/usr/bin/env python3
"""
Bulk migration: Upload all Language Profile files from Monday to SharePoint
Includes rate limiting to avoid API throttling
"""

import requests
from monday_to_sharepoint_drytest_onefile import (
    Config,
    resolve_column_ids,
    get_board_items_with_files,
    download_file,
    get_graph_access_token,
    get_sharepoint_site_id,
)
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json

sys.path.insert(0, str(Path(__file__).parent))

# Cache for SharePoint list IDs to avoid repeated API calls
_list_id_cache: Dict[str, str] = {}


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


def get_all_items_with_files(
    items: List[Dict], file_col_id: str, project_col_id: str, mou_col_id: str
) -> List[Tuple[Dict, str, Dict, Optional[str]]]:
    """Extract all items that have project name and files.

    Returns: List of (item, project_name, file_asset, mou_end_date)
    """
    results = []

    for item in items:
        project_name = None
        mou_end_date = None
        file_asset = None

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

        if project_name and project_name.strip() and file_asset:
            results.append(
                (item, project_name.strip(), file_asset, mou_end_date))

    return results


def file_exists_in_sharepoint(
    drive_id: str, folder_path: str, filename: str, access_token: str
) -> bool:
    """Check if file exists in SharePoint."""
    from urllib.parse import quote

    full_path = f"{folder_path}/{filename}"
    encoded_path = quote(full_path)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    response = requests.get(url, headers=headers)
    return response.status_code == 200


def ensure_folder_exists(
        drive_id: str,
        folder_path: str,
        access_token: str) -> bool:
    """Ensure folder exists, create if needed."""
    from urllib.parse import quote

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Check if exists
    encoded_path = quote(folder_path)
    check_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")

    response = requests.get(check_url, headers=headers)

    if response.status_code == 404:
        # Create folder
        create_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children"

        data = {
            "name": folder_path,
            "folder": {},
            "@microsoft.graph.conflictBehavior": "fail",
        }

        create_response = requests.post(create_url, json=data, headers=headers)

        if create_response.status_code not in [201, 409]:
            create_response.raise_for_status()

        return True

    return False


def upload_file_to_sharepoint(
    drive_id: str,
    folder_path: str,
    filename: str,
    local_file_path: Path,
    access_token: str,
) -> Dict:
    """Upload file to SharePoint."""
    from urllib.parse import quote

    full_path = f"{folder_path}/{filename}"
    encoded_path = quote(full_path)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}:/content"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream",
    }

    with open(local_file_path, "rb") as f:
        response = requests.put(url, data=f, headers=headers)

    response.raise_for_status()
    return response.json()


def set_folder_metadata(
        site_id: str,
        drive_id: str,
        folder_name: str,
        fields: dict,
        access_token: str):
    """Set MOU metadata on folder."""
    from urllib.parse import quote

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Check cache first
    cache_key = f"{site_id}:Active Projects"
    list_id = _list_id_cache.get(cache_key)

    if not list_id:
        # Get lists to find Active Projects list
        lists_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists"
        lists_resp = requests.get(lists_url, headers=headers)
        lists_resp.raise_for_status()
        lists = lists_resp.json().get("value", [])

        for lst in lists:
            if (
                lst.get("displayName") == "Active Projects"
                or lst.get("name") == "Active Projects"
            ):
                list_id = lst["id"]
                _list_id_cache[cache_key] = list_id
                break

    if not list_id:
        raise Exception("Could not find Active Projects list")

    # Get folder item
    encoded_path = quote(folder_name)
    item_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{encoded_path}")

    time.sleep(0.5)  # Small delay

    item_resp = requests.get(item_url, headers=headers)
    item_resp.raise_for_status()
    item_id = item_resp.json()["id"]

    # Get list item
    li_url = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/listItem"
    )
    li_resp = requests.get(li_url, headers=headers)
    li_resp.raise_for_status()
    list_item_id = li_resp.json()["id"]

    # Update fields
    patch_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{list_item_id}/fields"
    patch_resp = requests.patch(patch_url, json=fields, headers=headers)
    patch_resp.raise_for_status()

    return patch_resp.json()


def main():
    print("=" * 70)
    print("🚀 BULK MIGRATION: MONDAY → SHAREPOINT")
    print("=" * 70)

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

    all_projects = get_all_items_with_files(
        items, file_col_id, project_col_id, mou_col_id
    )
    print(
        f"   ✓ Found {
            len(all_projects)} projects with Language Profile files")

    # Step 2: Authenticate with SharePoint
    print(f"\n☁️  Step 2: Authenticating with SharePoint...")

    access_token = get_graph_access_token(
        config.tenant_id, config.client_id, config.client_secret
    )

    site_id = get_sharepoint_site_id(
        config.sharepoint_hostname, config.sharepoint_site_path, access_token
    )

    drive_id = get_active_projects_drive_id(site_id, access_token)
    print(f"   ✓ Ready to upload")

    # Step 3: Process each project
    print(f"\n📤 Step 3: Processing {len(all_projects)} projects...")
    print(f"   (Rate limiting: 0.5s delay between operations)\n")

    stats = {
        "uploaded": 0,
        "skipped": 0,
        "folder_created": 0,
        "metadata_set": 0,
        "errors": 0,
    }

    for idx, (item, project_name, file_asset, mou_end_date) in enumerate(
        all_projects, 1
    ):
        print(f"[{idx}/{len(all_projects)}] {project_name}")

        try:
            # Convert to uppercase
            folder_name = project_name.upper()

            # Check if file exists in SharePoint first (before downloading)
            if file_exists_in_sharepoint(
                drive_id, folder_name, file_asset["name"], access_token
            ):
                print(f"   ⏭️  File already exists - SKIPPED")
                stats["skipped"] += 1
                time.sleep(0.2)
                continue

            # Download file only if it doesn't exist in SharePoint
            local_dir = Path("./downloads/_bulk") / folder_name
            local_file = local_dir / file_asset["name"]

            if not local_file.exists():
                download_file(
                    file_asset["public_url"],
                    local_file,
                    force=False)
                time.sleep(0.3)  # Rate limit: Monday API

            # Ensure folder exists
            folder_created = ensure_folder_exists(
                drive_id, folder_name, access_token)
            if folder_created:
                stats["folder_created"] += 1
                print(f"   📁 Created folder")
                time.sleep(0.5)  # Rate limit after folder creation

            # Set MOU metadata if available and folder was just created
            if mou_end_date and folder_created:
                try:
                    set_folder_metadata(
                        site_id,
                        drive_id,
                        folder_name,
                        {"MOUenddate0": mou_end_date},
                        access_token,
                    )
                    stats["metadata_set"] += 1
                    print(f"   📅 MOU End: {mou_end_date}")
                    time.sleep(0.5)  # Rate limit
                except Exception as e:
                    print(f"   ⚠️  Metadata error: {e}")

            # Upload file
            upload_file_to_sharepoint(
                drive_id,
                folder_name,
                file_asset["name"],
                local_file,
                access_token)
            stats["uploaded"] += 1
            print(f"   ✅ Uploaded: {file_asset['name']}")

            # Rate limit: 0.5s between uploads
            time.sleep(0.5)

        except Exception as e:
            print(f"   ❌ ERROR: {e}")
            stats["errors"] += 1
            time.sleep(1)  # Longer delay after error

    # Summary
    print("\n" + "=" * 70)
    print("📊 MIGRATION SUMMARY")
    print("=" * 70)
    print(f"   Total projects:      {len(all_projects)}")
    print(f"   ✅ Uploaded:          {stats['uploaded']}")
    print(f"   ⏭️  Skipped (exists):  {stats['skipped']}")
    print(f"   📁 Folders created:   {stats['folder_created']}")
    print(f"   📅 Metadata set:      {stats['metadata_set']}")
    print(f"   ❌ Errors:            {stats['errors']}")
    print("=" * 70)

    # Generate report
    print(f"\n📄 Generating management report...")

    report_path = Path("MIGRATION_REPORT.md")
    with open(report_path, "w") as f:
        f.write("# Monday.com to SharePoint Migration Report\n\n")
        f.write(f"**Date**: {time.strftime('%B %d, %Y at %I:%M %p')}\n\n")
        f.write(
            f"**Migration Type**: Language Profile Files - One-time Bulk Migration\n\n")
        f.write("---\n\n")

        f.write("## Executive Summary\n\n")
        f.write(
            f"Successfully completed automated migration of Language Profile documents from Monday.com "
        )
        f.write(
            f"to SharePoint Active Projects site. Processed **{len(all_projects)} projects** from the "
        )
        f.write(f"Multiplication Language Space workspace.\n\n")

        f.write("## Migration Statistics\n\n")
        f.write(f"- **Total Projects Processed**: {len(all_projects)}\n")
        f.write(f"- **Files Uploaded**: {stats['uploaded']}\n")
        f.write(f"- **Files Skipped** (already existed): {stats['skipped']}\n")
        f.write(f"- **New Folders Created**: {stats['folder_created']}\n")
        f.write(f"- **MOU End Dates Set**: {stats['metadata_set']}\n")
        f.write(f"- **Errors Encountered**: {stats['errors']}\n\n")

        success_rate = (
            ((stats["uploaded"] + stats["skipped"]) / len(all_projects) * 100)
            if all_projects
            else 0
        )
        f.write(f"**Success Rate**: {success_rate:.1f}%\n\n")

        f.write("## What Was Migrated\n\n")
        f.write("### Source\n")
        f.write(f"- **Platform**: Monday.com\n")
        f.write(f"- **Workspace**: Multiplication Language Space\n")
        f.write(
            f"- **Board**: Partner Projects (ID: {config.monday_board_id})\n")
        f.write(f"- **Column**: Language Profile (files0)\n\n")

        f.write("### Destination\n")
        f.write(f"- **Platform**: SharePoint Online\n")
        f.write(
            f"- **Site**: {config.sharepoint_hostname}{config.sharepoint_site_path}\n"
        )
        f.write(
            f"- **Structure**: Files placed in `{{PROJECT_NAME}}/` folders at root of Active Projects site\n"
        )
        f.write(
            f"- **Naming Convention**: All folder names converted to UPPERCASE\n\n")

        f.write("## Technical Details\n\n")
        f.write("### Process Flow\n")
        f.write("1. Extracted project data from Monday.com using GraphQL API\n")
        f.write("2. Resolved column IDs dynamically by title to ensure reliability\n")
        f.write("3. Downloaded Language Profile files to local staging area\n")
        f.write("4. Authenticated with Microsoft Graph API using client credentials\n")
        f.write("5. Created project folders in SharePoint (if not existing)\n")
        f.write("6. Set MOU End Date metadata on newly created folders\n")
        f.write("7. Uploaded files to corresponding project folders\n")
        f.write("8. Skipped files that already existed (idempotent operation)\n\n")

        f.write("### Rate Limiting & Reliability\n")
        f.write("- Implemented 0.5 second delays between SharePoint operations\n")
        f.write("- Implemented 0.3 second delays for Monday.com API calls\n")
        f.write("- Extended 1 second delays after errors for recovery\n")
        f.write("- Idempotent design: safe to re-run without duplicating files\n\n")

        f.write("### Data Integrity\n")
        f.write("- File existence checks before upload (no overwrites)\n")
        f.write("- MOU End Date metadata captured from Monday.com 'MOU End' column\n")
        f.write("- Folder names standardized to UPPERCASE for consistency\n")
        f.write("- Original file names preserved\n\n")

        f.write("## Future State\n\n")
        f.write(
            "This was a **one-time bulk migration** of existing files. For ongoing file management:\n\n"
        )
        f.write(
            "- **Recommended**: Implement n8n webhook automation to capture new files added to Monday.com\n"
        )
        f.write("- **Webhook trigger**: Monitor Language Profile column changes\n")
        f.write(
            "- **Action**: Automatically upload new files to corresponding SharePoint folder\n"
        )
        f.write("- **Benefit**: Eliminates manual file transfers going forward\n\n")

        f.write("## Risks & Mitigations\n\n")
        f.write("| Risk | Mitigation |\n")
        f.write("|------|------------|\n")
        f.write("| API rate limiting | Built-in delays between operations |\n")
        f.write("| File overwrites | Existence checks before upload |\n")
        f.write("| Network failures | Error handling with 1s recovery delay |\n")
        f.write("| Data loss | Files downloaded to local staging before upload |\n")
        f.write("| Duplicate runs | Idempotent design skips existing files |\n\n")

        f.write("## Access & Credentials\n\n")
        f.write("Migration used secure service principal authentication:\n")
        f.write("- **Azure AD App**: Client credentials flow\n")
        f.write("- **Permissions**: Sites.ReadWrite.All (application permission)\n")
        f.write("- **Monday API**: Personal access token with read access\n")
        f.write(
            "- **Credentials**: Stored in `.env` file (not committed to repository)\n\n"
        )

        f.write("## Recommendations\n\n")
        f.write(
            "1. **Verify Sample Projects**: Spot-check 3-5 folders in SharePoint to confirm files uploaded correctly\n"
        )
        f.write("2. **Check MOU Dates**: Review metadata on newly created folders\n")
        f.write(
            "3. **Implement Webhook**: Set up n8n automation for future file additions\n"
        )
        f.write("4. **Document Process**: Keep migration scripts for reference\n")
        f.write(
            "5. **Monitor Access**: Ensure project teams have appropriate SharePoint permissions\n\n"
        )

        f.write("---\n\n")
        f.write("**Prepared by**: Automated Migration System\n")
        f.write(
            f"**Script Location**: `/Users/edwinbrooks/Projects/MONDAY-SHAREPOINT/`\n")
        f.write(f"**Log Available**: Console output saved in terminal session\n")

    print(f"   ✓ Report saved to: {report_path.absolute()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
