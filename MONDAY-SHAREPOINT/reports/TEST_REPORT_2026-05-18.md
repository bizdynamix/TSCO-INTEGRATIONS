# Monday → SharePoint Sync — Test Report

**Date:** May 18, 2026  
**Project:** Monday.com → SharePoint Language Profile Sync  
**Platform:** Monday Code (App ID: 11162221)  
**Tested by:** Edwin Brooks  

---

## 1. Unit Test Results — All Scenarios

**Tool:** pytest 9.0.3 · Python 3.14.3  
**File:** `tests/test_webhook_handler.py`  
**Result: 12/12 PASSED in 0.26s**

| # | Scenario | Expected Behaviour | Result |
|---|----------|--------------------|--------|
| 1 | Language Profile column modified, file present | Sync triggered → file uploaded to SharePoint | ✅ PASSED |
| 2 | Language Status → "Active", file present | Sync triggered → file uploaded to SharePoint | ✅ PASSED |
| 3 | Language Status → "Active", no file uploaded | Ignored — `reason: no_file` | ✅ PASSED |
| 4 | Language Status → any value other than "Active" | Ignored — `reason: status_not_active` | ✅ PASSED |
| 5 | Monday challenge verification (POST body) | Challenge echoed back correctly | ✅ PASSED |
| 6 | Monday challenge verification (GET query param) | Challenge echoed back correctly | ✅ PASSED |
| 7 | Empty webhook payload | Returns HTTP 400 | ✅ PASSED |
| 8 | Webhook payload missing item ID | Returns error response | ✅ PASSED |
| 9 | Unrecognised column change, file present | Ignored — `reason: no_trigger` | ✅ PASSED |
| 10 | SharePoint metadata patch fails mid-sync | Sync completes — metadata failure is non-fatal | ✅ PASSED |
| 11 | File column has ID but no downloadable asset | Returns HTTP 400, not 500 | ✅ PASSED |
| 12 | Same webhook fired twice (duplicate event) | Both uploads succeed — idempotent overwrite | ✅ PASSED |

---

## 2. Live Integration Test — Real Monday Item + SharePoint

**Script:** `diagnose_sync.py`  
**Monday Item:** `11832064528` ("Test Engagement 2"), Board `18409984885`  
**SharePoint Target:** `seedcompany.sharepoint.com/sites/ActiveProjects`  
**Run time:** 2026-05-18 12:24 UTC  

| Step | Result | Detail |
|------|--------|--------|
| Credentials check | ✅ PASSED | All 4 required env vars present |
| Monday API — item fetch | ✅ PASSED | File found in column `files0` |
| Monday API — asset download | ✅ PASSED | `Born For Greatness Sermon MOBILE.pdf` (32,710 bytes) downloaded from S3 |
| SharePoint auth (Azure AD) | ✅ PASSED | Graph token obtained, valid 3,599s |
| SharePoint site lookup | ✅ PASSED | Site ID resolved |
| SharePoint drive lookup | ✅ PASSED | "Active Projects" drive located |
| SharePoint folder | ✅ PASSED | `TEST_SYNC_DIAGNOSTIC` folder confirmed |
| File upload to SharePoint | ✅ PASSED | File live at `/sites/ActiveProjects/Projects/TEST_SYNC_DIAGNOSTIC/` |

**File confirmed live at:**  
`https://seedcompany.sharepoint.com/sites/ActiveProjects/Projects/TEST_SYNC_DIAGNOSTIC/Born%20For%20Greatness%20Sermon%20MOBILE.pdf`

---

## 3. Live Webhook Endpoint Check

**Deployed URL:** `https://a5d57-service-12597801-ef203e65.us.monday.app`

| Check | Result |
|-------|--------|
| Endpoint reachable (GET) | ✅ Responding |
| Challenge verification | ✅ Echo confirmed |
| Webhook processing logic | ✅ Trigger conditions evaluated correctly |

---

## Summary

| Test Layer | Scenarios | Result |
|------------|-----------|--------|
| Unit tests (offline) | 12 | ✅ 12/12 PASSED |
| Live integration (real Monday + SharePoint) | 8 steps | ✅ All steps PASSED |
| Deployed webhook endpoint | Reachable + challenge | ✅ PASSED |

**The Monday → SharePoint sync system is fully operational and all scenarios have been tested and verified.**
