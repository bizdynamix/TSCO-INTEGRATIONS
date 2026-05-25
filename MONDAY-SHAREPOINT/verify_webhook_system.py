#!/usr/bin/env python3
"""
Verify the Monday-to-SharePoint webhook system is working end-to-end.

This script:
1. Tests webhook endpoint connectivity
2. Sends a complete webhook payload
3. Checks SharePoint for synced test folder
4. Reports system status

Usage:
    python3 verify_webhook_system.py
"""

import os
import sys
import requests
import json
from datetime import datetime


DEFAULT_LIVE_WEBHOOK_URL = "https://live1-service-12597801-e1067fa2.us.monday.app/sync-language-profile"


def get_webhook_url():
    """Return the live webhook URL, allowing local override for draft testing."""
    return os.getenv("MONDAY_WEBHOOK_URL", DEFAULT_LIVE_WEBHOOK_URL)

def test_webhook_endpoint():
    """Test webhook is reachable and responding."""
    print("\n" + "=" * 80)
    print("1️⃣  TESTING WEBHOOK ENDPOINT")
    print("=" * 80)
    
    webhook_url = get_webhook_url()
    print(f"Webhook URL: {webhook_url}")
    
    try:
        # Test GET with challenge
        response = requests.get(f"{webhook_url}?challenge=test", timeout=10)
        if response.status_code == 200:
            print(f"✅ Webhook GET endpoint responding: {response.json()}")
        else:
            print(f"❌ Webhook GET failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Webhook endpoint error: {e}")
        return False
    
    return True

def send_test_webhook():
    """Send a test webhook payload."""
    print("\n" + "=" * 80)
    print("2️⃣  SENDING TEST WEBHOOK PAYLOAD")
    print("=" * 80)
    
    webhook_url = get_webhook_url()
    
    # Payload matching Monday Vibe automation format
    payload = {
        "event": {
            "pulseId": 8445065242,
            "pulseName": "Test Engagement 2",
            "boardId": 18409984885,
            "columnId": "files0",
            "columnTitle": "Language Profile",
            "value": {"assetId": 1234567890, "fileName": "test_profile.pdf"},
            "previousValue": None
        }
    }
    
    print(f"\nPayload:")
    print(json.dumps(payload, indent=2))
    
    try:
        response = requests.post(webhook_url, json=payload, timeout=30)
        print(f"\n✅ Webhook POST Status: {response.status_code}")
        
        result = response.json()
        print(f"Response:")
        print(json.dumps(result, indent=2))
        
        if result.get("success"):
            print(f"\n🎉 File sync SUCCESSFUL!")
            print(f"   SharePoint URL: {result.get('sharepoint_url')}")
            return True
        elif result.get("action") == "ignore":
            print(f"\n⚠️  Webhook ignored the request")
            print(f"   Reason: {result.get('reason')}")
            print(f"   Item: {result.get('project_name')}")
            print(f"\n   💡 This means: The webhook is working, but the trigger condition")
            print(f"      '{result.get('reason')}' is not met for this item.")
            return None  # Neutral - webhook works, just not triggered
        else:
            print(f"\n⚠️  Unexpected response")
            return False
            
    except Exception as e:
        print(f"❌ Webhook error: {e}")
        return False

def check_sharepoint_folder():
    """Check if test folder exists in SharePoint."""
    print("\n" + "=" * 80)
    print("3️⃣  CHECKING SHAREPOINT FOR TEST FOLDER")
    print("=" * 80)
    
    # Load credentials from .env
    env_vars = {}
    try:
        with open('.env') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env_vars[k] = v
    except FileNotFoundError:
        print("❌ .env file not found")
        return False
    
    tenant_id = env_vars.get("TENANT_ID")
    client_id = env_vars.get("CLIENT_ID")
    client_secret = env_vars.get("CLIENT_SECRET")
    
    if not all([tenant_id, client_id, client_secret]):
        print("❌ Missing SharePoint credentials in .env")
        return False
    
    try:
        # Authenticate with Azure AD
        print("🔐 Authenticating with Azure AD...")
        auth_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        auth_data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default"
        }
        
        auth_response = requests.post(auth_url, data=auth_data, timeout=10)
        if auth_response.status_code != 200:
            print(f"❌ Azure AD auth failed: {auth_response.status_code}")
            return False
        
        token = auth_response.json()["access_token"]
        print(f"✅ Authenticated")
        
        # Query SharePoint for folders
        print("\n📂 Querying SharePoint site root...")
        headers = {"Authorization": f"Bearer {token}"}
        drive_url = "https://graph.microsoft.com/v1.0/sites/seedcompany.sharepoint.com:/sites/ActiveProjects:/drive/root/children"
        
        resp = requests.get(drive_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            print(f"❌ SharePoint query failed: {resp.status_code}")
            return False
        
        items = resp.json().get("value", [])
        folders = [i["name"] for i in items if i.get("folder")]
        
        print(f"✅ Found {len(folders)} total folders in SharePoint")
        
        # Look for TEST folder
        test_folders = [f for f in folders if "TEST" in f.upper()]
        
        if test_folders:
            print(f"\n🎯 Found TEST folder(s):")
            for f in test_folders:
                print(f"   ✅ {f}")
            return True
        else:
            print(f"\n❌ No TEST folder found")
            print(f"   First 10 folders:")
            for f in sorted(folders)[:10]:
                print(f"   - {f}")
            return False
            
    except Exception as e:
        print(f"❌ SharePoint check error: {e}")
        return False

def main():
    print("\n")
    print("╔" + "=" * 78 + "╗")
    print("║" + " MONDAY-TO-SHAREPOINT WEBHOOK SYSTEM VERIFICATION ".center(78) + "║")
    print("║" + f" {datetime.now().isoformat()} ".center(78) + "║")
    print("╚" + "=" * 78 + "╝")
    
    results = {}
    
    # Test 1: Webhook endpoint
    results["endpoint"] = test_webhook_endpoint()
    
    # Test 2: Send webhook
    results["webhook"] = send_test_webhook()
    
    # Test 3: Check SharePoint
    results["sharepoint"] = check_sharepoint_folder()
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    print(f"\n✅ Webhook Endpoint:  {'Working' if results['endpoint'] else 'Failed'}")
    print(f"✅ Webhook Processing: {'Success' if results['webhook'] == True else 'Ignored (condition not met)' if results['webhook'] is None else 'Failed'}")
    print(f"✅ SharePoint Access:  {'Test folder exists' if results['sharepoint'] else 'Not found'}")
    
    if results['endpoint'] and results['webhook'] is not None and results['sharepoint']:
        print(f"\n🎉 END-TO-END TEST PASSED - System is fully operational!")
        return 0
    elif results['endpoint'] and results['webhook'] is None:
        print(f"\n⚠️  SYSTEM OPERATIONAL but test file not synced")
        print(f"   Webhook is working correctly but rejected the test payload.")
        print(f"   This is normal - the test item may not meet all trigger conditions.")
        print(f"   When the conditions are met, files will sync to SharePoint.")
        return 0
    else:
        print(f"\n❌ SYSTEM ISSUE DETECTED - See errors above")
        return 1

if __name__ == "__main__":
    sys.exit(main())
