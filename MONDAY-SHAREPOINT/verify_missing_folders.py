#!/usr/bin/env python3
"""
Verify if KAISANDOSA CLUSTER 2 and NORTH KIVU CLUSTER folders exist in SharePoint.
Checks via Microsoft Graph API to see if folders are present despite not being visible in UI.
"""

import os
import sys
import requests
from typing import Optional


class Config:
    """Configuration from environment variables"""
    def __init__(self):
        self.tenant_id = os.getenv("TENANT_ID")
        self.client_id = os.getenv("CLIENT_ID")
        self.client_secret = os.getenv("CLIENT_SECRET")
        self.sharepoint_hostname = os.getenv("SHAREPOINT_HOSTNAME", "seedcompany.sharepoint.com")
        self.sharepoint_site_path = os.getenv("SHAREPOINT_SITE_PATH", "/sites/ActiveProjects")
        
        if not all([self.tenant_id, self.client_id, self.client_secret]):
            raise ValueError("Missing required environment variables: TENANT_ID, CLIENT_ID, CLIENT_SECRET")


def get_graph_access_token(config: Config) -> str:
    """Get access token for Microsoft Graph API using client credentials"""
    token_url = f"https://login.microsoftonline.com/{config.tenant_id}/oauth2/v2.0/token"
    token_data = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials"
    }
    
    response = requests.post(token_url, data=token_data)
    response.raise_for_status()
    return response.json()["access_token"]


def get_sharepoint_site_id(access_token: str, hostname: str, site_path: str) -> str:
    """Get SharePoint site ID"""
    url = f"https://graph.microsoft.com/v1.0/sites/{hostname}:{site_path}"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()["id"]


def get_active_projects_drive_id(access_token: str, site_id: str) -> str:
    """Get the 'Active Projects' drive ID (not the default Documents drive)"""
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    drives = response.json().get("value", [])
    for drive in drives:
        if drive.get("name") == "Active Projects":
            return drive["id"]
    
    raise ValueError("Could not find 'Active Projects' drive")


def check_folder_exists(access_token: str, drive_id: str, folder_name: str) -> dict:
    """
    Check if a folder exists and return its details.
    Returns dict with 'exists', 'error', 'folder_info', and 'files' keys.
    """
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{folder_name}"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    result = {
        "exists": False,
        "error": None,
        "folder_info": None,
        "files": []
    }
    
    # Check if folder exists
    response = requests.get(url, headers=headers)
    
    if response.status_code == 404:
        result["error"] = "Folder not found (404)"
        return result
    elif response.status_code != 200:
        result["error"] = f"Error {response.status_code}: {response.text}"
        return result
    
    result["exists"] = True
    folder_data = response.json()
    result["folder_info"] = {
        "id": folder_data.get("id"),
        "name": folder_data.get("name"),
        "webUrl": folder_data.get("webUrl"),
        "createdDateTime": folder_data.get("createdDateTime"),
        "lastModifiedDateTime": folder_data.get("lastModifiedDateTime")
    }
    
    # Get files in folder
    files_url = f"{url}:/children"
    files_response = requests.get(files_url, headers=headers)
    
    if files_response.status_code == 200:
        items = files_response.json().get("value", [])
        result["files"] = [
            {
                "name": item.get("name"),
                "size": item.get("size"),
                "createdDateTime": item.get("createdDateTime"),
                "webUrl": item.get("webUrl")
            }
            for item in items
            if "folder" not in item  # Only files, not subfolders
        ]
    
    return result


def main():
    print("=" * 70)
    print("VERIFYING MISSING SHAREPOINT FOLDERS")
    print("=" * 70)
    print()
    
    # Load config
    try:
        config = Config()
        print("✓ Configuration loaded")
    except ValueError as e:
        print(f"❌ Configuration error: {e}")
        return 1
    
    # Authenticate
    print("\n☁️  Authenticating with SharePoint...")
    try:
        access_token = get_graph_access_token(config)
        site_id = get_sharepoint_site_id(access_token, config.sharepoint_hostname, config.sharepoint_site_path)
        drive_id = get_active_projects_drive_id(access_token, site_id)
        print("   ✓ Authentication successful")
        print(f"   ✓ Active Projects Drive ID: {drive_id}")
    except Exception as e:
        print(f"   ❌ Authentication failed: {e}")
        return 1
    
    # Check both folders
    folders_to_check = [
        "KAISANDOSA CLUSTER 2",
        "NORTH KIVU CLUSTER"
    ]
    
    print("\n" + "=" * 70)
    print("VERIFICATION RESULTS")
    print("=" * 70)
    
    for folder_name in folders_to_check:
        print(f"\n📁 Checking: {folder_name}")
        print("-" * 70)
        
        result = check_folder_exists(access_token, drive_id, folder_name)
        
        if result["exists"]:
            print(f"   ✅ FOLDER EXISTS")
            info = result["folder_info"]
            print(f"   • Folder ID: {info['id']}")
            print(f"   • Created: {info['createdDateTime']}")
            print(f"   • Modified: {info['lastModifiedDateTime']}")
            print(f"   • Web URL: {info['webUrl']}")
            
            if result["files"]:
                print(f"\n   📄 Files in folder ({len(result['files'])}):")
                for file in result["files"]:
                    size_kb = file['size'] / 1024
                    print(f"      • {file['name']} ({size_kb:.1f} KB)")
                    print(f"        Created: {file['createdDateTime']}")
            else:
                print(f"\n   ⚠️  No files found in folder")
        else:
            print(f"   ❌ FOLDER NOT FOUND")
            if result["error"]:
                print(f"   • Error: {result['error']}")
    
    print("\n" + "=" * 70)
    print("VERIFICATION COMPLETE")
    print("=" * 70)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
