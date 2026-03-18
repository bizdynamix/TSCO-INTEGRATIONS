#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import sys
sys.path.insert(0, str(Path(__file__).parent))

from monday_to_sharepoint_drytest_onefile import get_graph_access_token, get_sharepoint_site_id
from bulk_migrate_all import get_active_projects_drive_id, Config
import requests

config = Config()
access_token = get_graph_access_token(config.tenant_id, config.client_id, config.client_secret)
site_id = get_sharepoint_site_id(config.sharepoint_hostname, config.sharepoint_site_path, access_token)
drive_id = get_active_projects_drive_id(site_id, access_token)

headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
url = f'https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children'

response = requests.get(url, headers=headers)
folders = response.json().get('value', [])

tonga_folders = [f['name'] for f in folders if 'tonga' in f['name'].lower() and f.get('folder')]
print(f'Tonga in SharePoint: {tonga_folders if tonga_folders else "NOT FOUND"}')
