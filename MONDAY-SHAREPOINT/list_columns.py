#!/usr/bin/env python3
"""List all columns on the Monday board"""
import os
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

import sys
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import Config
import requests

config = Config()

query = """
query ($boardId: [ID!]!) {
    boards(ids: $boardId) {
        columns {
            id
            title
            type
        }
    }
}
"""

headers = {
    'Authorization': config.monday_api_token,
    'Content-Type': 'application/json'
}

response = requests.post(
    'https://api.monday.com/v2',
    json={'query': query, 'variables': {'boardId': [config.monday_board_id]}},
    headers=headers
)

data = response.json()
columns = data.get('data', {}).get('boards', [{}])[0].get('columns', [])

print('Board columns:')
print('-' * 80)
for col in columns:
    marker = "***" if 'status' in col['title'].lower() or 'lang' in col['title'].lower() else "   "
    print(f"{marker} {col['id']:25} | {col['title']:35} | {col['type']}")
