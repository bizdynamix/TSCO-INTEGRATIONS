#!/usr/bin/env python3
"""Search Monday.com board for Tonga project and check for Language Profile file"""
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import sys
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import (
    Config, resolve_column_ids, get_graph_access_token, get_sharepoint_site_id
)
from bulk_migrate_all import get_active_projects_drive_id
import requests
import json

config = Config()

# Get column IDs
print("🔍 Searching Monday.com for Tonga...")

column_map = resolve_column_ids(
    config.monday_board_id,
    config.monday_api_token,
    [config.column_title_files, config.column_title_project, config.column_title_mou_end_date]
)

file_col_id = column_map[config.column_title_files]
project_col_id = column_map[config.column_title_project]

# Search for Tonga in Monday
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

# Find Tonga
tonga_items = []
for item in items:
    project_name = None
    file_info = None
    
    for col in item.get("column_values", []):
        if col["id"] == project_col_id:
            project_name = col.get("text", "")
        if col["id"] == file_col_id and col.get("value"):
            file_info = col.get("value")
    
    if project_name and "tonga" in project_name.lower():
        tonga_items.append({
            "id": item["id"],
            "name": item["name"],
            "project_name": project_name,
            "file_info": file_info,
            "assets": item.get("assets", [])
        })

print(f"\n📋 Found {len(tonga_items)} items containing 'Tonga':\n")

for item in tonga_items:
    print(f"Item: {item['name']}")
    print(f"  Project Name: {item['project_name']}")
    print(f"  Monday Item ID: {item['id']}")
    
    if item['file_info']:
        try:
            file_data = json.loads(item['file_info'])
            print(f"  File column data: {file_data}")
        except:
            print(f"  File column (raw): {item['file_info']}")
    else:
        print(f"  ❌ No Language Profile file attached!")
    
    if item['assets']:
        print(f"  Assets: {[a['name'] for a in item['assets']]}")
        for asset in item['assets']:
            print(f"    - {asset['name']}: {asset['public_url']}")
    else:
        print(f"  ❌ No assets attached!")
    print()
