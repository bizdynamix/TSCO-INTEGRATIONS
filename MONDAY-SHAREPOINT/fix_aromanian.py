#!/usr/bin/env python3
"""Upload Aromanian file with fixed folder name (colon replaced with hyphen)"""

import requests
import os
import json
from dotenv import load_dotenv

load_dotenv()

# Config
MONDAY_API_TOKEN = os.getenv('MONDAY_API_TOKEN')
TENANT_ID = os.getenv('TENANT_ID')
CLIENT_ID = os.getenv('CLIENT_ID')
CLIENT_SECRET = os.getenv('CLIENT_SECRET')

# Get Graph token
print("🔐 Getting Graph API token...")
token_url = f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token'
token_resp = requests.post(token_url, data={
    'grant_type': 'client_credentials',
    'client_id': CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'scope': 'https://graph.microsoft.com/.default'
})
access_token = token_resp.json()['access_token']
headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}

# Get site and drive IDs
print("📂 Getting SharePoint site info...")
site_resp = requests.get('https://graph.microsoft.com/v1.0/sites/seedcompany.sharepoint.com:/sites/ActiveProjects', headers=headers)
site_id = site_resp.json()['id']

drives_resp = requests.get(f'https://graph.microsoft.com/v1.0/sites/{site_id}/drives', headers=headers)
drive_id = next(d['id'] for d in drives_resp.json()['value'] if d['name'] == 'Active Projects')

# Fixed folder name (replace colon with hyphen)
folder_name = 'AROMANIAN - FRASHEROT'  # Fixed: removed colon
file_name = 'Aromanian Project Profile Final.docx'

# Download file from Monday
print(f'📥 Downloading {file_name} from Monday.com...')
monday_headers = {'Authorization': MONDAY_API_TOKEN, 'Content-Type': 'application/json'}
query = '''{ boards(ids: 8445103301) { items_page(limit: 500) { items { name column_values(ids: ["project_mkm1qfap", "files0"]) { id value } assets { id name public_url } } } } }'''
resp = requests.post('https://api.monday.com/v2', json={'query': query}, headers=monday_headers)
items = resp.json()['data']['boards'][0]['items_page']['items']

# Find Aromanian item
for item in items:
    cols = {c['id']: c['value'] for c in item['column_values']}
    project = json.loads(cols.get('project_mkm1qfap') or '""') or ''
    if 'AROMANIAN' in project.upper():
        print(f"   Found item: {item['name']} -> {project}")
        # Find file asset
        file_col = json.loads(cols.get('files0') or '{}')
        if 'files' in file_col:
            asset_id = file_col['files'][0].get('assetId')
            for asset in item['assets']:
                if str(asset['id']) == str(asset_id):
                    # Download
                    file_resp = requests.get(asset['public_url'])
                    file_content = file_resp.content
                    print(f'   Downloaded {len(file_content)} bytes')
                    
                    # Create folder
                    print(f'📁 Creating folder {folder_name}...')
                    folder_body = {'name': folder_name, 'folder': {}, '@microsoft.graph.conflictBehavior': 'fail'}
                    requests.post(f'https://graph.microsoft.com/v1.0/drives/{drive_id}/root/children', headers=headers, json=folder_body)
                    
                    # Upload file
                    print(f'📤 Uploading {file_name}...')
                    upload_url = f'https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{folder_name}/{file_name}:/content'
                    upload_headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/octet-stream'}
                    upload_resp = requests.put(upload_url, headers=upload_headers, data=file_content)
                    upload_resp.raise_for_status()
                    print('✅ Done!')
                    break
        break
