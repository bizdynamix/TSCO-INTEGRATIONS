#!/usr/bin/env python3
"""Diagnose why we're seeing fewer ACTIVE projects than expected"""
import os
from dotenv import load_dotenv
from pathlib import Path
import json

load_dotenv(Path(__file__).parent / ".env")

import sys
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import Config, resolve_column_ids
import requests

config = Config()

print("🔍 Diagnosing ACTIVE project count discrepancy...\n")

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
            cursor
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
items_page = data.get("data", {}).get("boards", [{}])[0].get("items_page", {})
items = items_page.get("items", [])
cursor = items_page.get("cursor")

print(f"📊 First page: {len(items)} items")
print(f"   Cursor for next page: {cursor}")

# Count categories
total_items = len(items)
active_items = 0
active_with_file_col = 0
active_with_file_asset = 0
active_with_project_name = 0
active_complete = 0

issues = []

for item in items:
    lang_status = None
    project_name = None
    has_file_in_column = False
    file_asset = None
    file_asset_id = None
    
    for col in item.get("column_values", []):
        if col["id"] == lang_status_col_id:
            lang_status = col.get("text", "").strip().upper()
        elif col["id"] == project_col_id:
            project_name = col.get("text", "")
        elif col["id"] == file_col_id:
            if col.get("value"):
                has_file_in_column = True
                try:
                    file_data = json.loads(col["value"])
                    if "files" in file_data and file_data["files"]:
                        file_asset_id = file_data["files"][0].get("assetId")
                except:
                    pass
    
    # Find matching asset
    if file_asset_id:
        for asset in item.get("assets", []):
            if str(asset["id"]) == str(file_asset_id):
                file_asset = asset
                break
    
    if lang_status == "ACTIVE":
        active_items += 1
        
        if has_file_in_column:
            active_with_file_col += 1
        
        if file_asset:
            active_with_file_asset += 1
        
        if project_name and project_name.strip():
            active_with_project_name += 1
        
        if project_name and project_name.strip() and file_asset:
            active_complete += 1
        else:
            # Track why this was excluded
            reason = []
            if not project_name or not project_name.strip():
                reason.append("no project name")
            if has_file_in_column and not file_asset:
                reason.append(f"file in column but no matching asset (assetId: {file_asset_id})")
            if not has_file_in_column:
                reason.append("no file in Language Profile column")
            
            if reason:
                issues.append({
                    "name": item["name"],
                    "id": item["id"],
                    "project_name": project_name,
                    "reason": ", ".join(reason),
                    "assets": [a["name"] for a in item.get("assets", [])]
                })

print(f"\n📋 BREAKDOWN:")
print(f"   Total items on board:           {total_items}")
print(f"   ACTIVE status:                  {active_items}")
print(f"   ACTIVE with file in column:     {active_with_file_col}")
print(f"   ACTIVE with matching asset:     {active_with_file_asset}")
print(f"   ACTIVE with project name:       {active_with_project_name}")
print(f"   ACTIVE complete (name + asset): {active_complete}")

print(f"\n⚠️  ACTIVE items excluded ({active_items - active_complete}):")
print("-" * 70)
for issue in issues[:20]:  # Show first 20
    print(f"\n  Item: {issue['name']} (ID: {issue['id']})")
    print(f"  Project Name: '{issue['project_name']}'")
    print(f"  Reason: {issue['reason']}")
    if issue['assets']:
        print(f"  Available assets: {issue['assets'][:3]}...")

if len(issues) > 20:
    print(f"\n  ... and {len(issues) - 20} more")

print(f"\n📊 Summary: {active_complete} ACTIVE projects with both name and Language Profile file")
print(f"   Missing: {active_items - active_complete} ACTIVE projects excluded")
