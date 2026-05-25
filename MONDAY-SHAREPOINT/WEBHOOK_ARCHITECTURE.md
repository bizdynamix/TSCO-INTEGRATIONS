# Webhook Architecture — How It Works

## Event-Driven Flow (Not Polling)

```
┌─────────────────────────────────────────────────────────────────┐
│ MONDAY VIBE AUTOMATION (Trigger Setup Already Done)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  When: Language Status changes to "Active"                       │
│     OR Language Profile file column is modified                  │
│                                                                   │
│  Then: POST item payload to Monday Code action endpoint          │
│        https://a7673-service-12597801-ef203e65.us.monday.app     │
│        /monday/action                                            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                             ↓
                      (WEBHOOK RECEIVES)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ WEBHOOK HANDLER (webhook_handler.py on Monday Code)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ Receives JSON payload from Monday containing:                    │
│ ├─ itemId: 12345                                                 │
│ └─ optional boardId                                               │
│                                                                   │
│ Then fetches the rest from Monday API:                           │
│ ├─ project_name: "Project Name"                                  │
│ ├─ language_status / file column                                  │
│ └─ MOU End Date: "2026-12-31"                                    │
│                                                                   │
│ Checks trigger conditions:                                       │
│ ├─ Trigger 1: File exists in payload? → SYNC                    │
│ ├─ Trigger 2: Language Status = "Active" + file? → SYNC          │
│ └─ Otherwise → IGNORE                                            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                             ↓
                        (TRIGGERS MET)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ SYNC PROCESS                                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ 1. Extract file download URL from Monday payload                 │
│ 2. Download file from Monday's storage                           │
│ 3. Authenticate with SharePoint (OAuth2)                         │
│ 4. Upload to SharePoint folder:                                  │
│    /sites/ActiveProjects/{PROJECT_NAME_UPPERCASE}/               │
│ 5. Set MOU End Date metadata                                     │
│ 6. Return success response to Monday                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Points

### What Webhook Does NOT Do
- ❌ Does NOT poll Monday board
- ❌ Does NOT query Monday GraphQL API (except file downloads)
- ❌ Does NOT check status continuously
- ❌ Does NOT wake up on schedule

### What Webhook DOES Do
- ✅ Listens for POST requests from Monday
- ✅ Reacts to Monday's webhook payload
- ✅ Extracts data from payload (no API calls needed)
- ✅ Checks file existence and status in payload data
- ✅ Downloads file URL provided by Monday
- ✅ Uploads to SharePoint
- ✅ Logs each action

### Why This Approach?
- **Event-Driven:** Only runs when Monday sends webhook
- **No Polling:** Doesn't consume resources between events
- **Fast:** 1-2 second response time
- **Reliable:** Monday controls when webhook runs
- **Scalable:** Can handle many events without load

---

## Payload Example

When Monday triggers automation, it sends:

```json
{
  "item": {
    "id": 123456789,
    "name": "Project Alpha"
  },
  "column_values": [
    {
      "id": "status_col",
      "title": "Language Status",
      "type": "status",
      "value": "Active"
    },
    {
      "id": "file_col",
      "title": "Language Profile",
      "type": "file",
      "value": "{\"asset_id\": 987654, \"url\": \"https://...\"}"
    },
    {
      "id": "fpm_col",
      "title": "FPM",
      "type": "people",
      "value": "{\"id\": 555, \"name\": \"John Doe\"}"
    },
    {
      "id": "date_col",
      "title": "MOU End Date",
      "type": "date",
      "value": "2026-12-31"
    }
  ]
}
```

Webhook extracts this data (no API call to Monday needed) and decides whether to sync.

---

## File Download Flow

The file URL is **embedded in the Monday payload**, so webhook:

1. Extracts URL from `column_values[file].value.url`
2. Downloads directly using that URL (requests.get)
3. Saves to temp directory
4. Uploads to SharePoint

**No Monday API authentication needed for file download** — URL is direct download link.

---

## Monitoring

When webhook triggers and syncs:

```bash
# View real-time activity
journalctl -u monday-webhook -f

# Sample output:
# 📨 WEBHOOK RECEIVED
# Item: Project Alpha (ID: 123456789)
# Language Status: Active
# Has Language Profile: True
# 🎯 Language Profile file detected - syncing regardless of Language Status
# 📥 Step 1: Fetching file from Monday...
# ⬇️ Step 2: Downloading file...
# 🔐 Step 3: Authenticating with SharePoint...
# 📤 Step 4: Uploading to SharePoint...
# ✓ File uploaded: https://seedcompany.sharepoint.com/sites/ActiveProjects/PROJECT%20ALPHA/...
```

---

## Summary

**Webhook is NOT checking Monday — Monday is notifying the webhook.**

The trigger is set up in Monday Vibe Automation (already done), which sends a webhook POST whenever:
- Language Status changes to "Active", OR
- Language Profile file is added/modified

Webhook receives the notification, checks the data in the payload, and syncs if conditions are met.

No continuous polling. No API queries. Just event-driven reactions.
