# Monday Webhook Setup — Complete Guide

## Quick Reference

> Note (May 2026): This document is for internal troubleshooting only. We do not want end users pasting webhook URLs into Monday Vibe. The supported setup is a native Monday app/plugin recipe or workflow template that users install from Browse integrations.

**Automation Endpoint:** `https://a7673-service-12597801-ef203e65.us.monday.app/monday/action`

Use this guide only when you need a manual fallback during debugging.

---

## Setup in Monday Vibe Automation

### Step 1: Open Board
- Go to Board **18409984885** (Engagement Proposal)
- Click **Automation** (wrench icon, top-right)

### Step 2: Create New Automation

Click **Create automation** or edit existing.

### Step 3: Add Trigger

**Trigger Name:** "Language Status → Active"

**Configuration:**
```
When: "Status changes to specific status"
Column: Language Status
Value: Active
```

### Step 4: Add Action — Make an API Call (Internal Debug Only)

Click **Then → Make an API call** only if you are using the manual debug fallback.

**Fill in:**
```
Method: POST

URL: https://a7673-service-12597801-ef203e65.us.monday.app/monday/action

Headers:
  Content-Type: application/json

Body (JSON):
{
  "itemId": {item_id}
}
```

### Step 5: Publish

- Click **Publish** button
- Toggle **ON** to enable

---

## Optional: Add Second Trigger (File Changes)

For syncing when file is added **regardless of status**:

**Trigger Name:** "Language Profile File Modified"

**Configuration:**
```
When: "Column value changes"
Column: Language Profile

Then: Make an API call
[same POST action details as above]
```

This ensures syncs happen for:
- ✅ File added (any status) → TRIGGER 2
- ✅ Status changed to Active (with file) → TRIGGER 1

---

## What Happens When Triggered

1. **Item updated in Monday** → Status changes to Active (or file is added)
2. **Monday sends POST** → App receives the item ID
3. **Webhook checks conditions:**
  - Fetches item details from Monday API
  - Has file? → SYNC
  - Otherwise → IGNORE
4. **If sync triggered:**
   - Downloads file from Monday
   - Uploads to SharePoint: `/sites/ActiveProjects/{PROJECT_NAME_UPPERCASE}/`
   - Sets MOU End Date metadata
   - Returns success response

---

## Testing the Webhook

### Test Scenario 1: Status Change
1. Pick a project with Language Profile file already uploaded
2. Change Language Status to "Active"
3. Check webhook logs: `journalctl -u monday-webhook -f`
4. Should see: "🎯 Language Status is Active with file - syncing"
5. Verify file appears in SharePoint

### Test Scenario 2: File Change
1. Pick a project (any status)
2. Upload/replace Language Profile file
3. Check webhook logs
4. Should see: "🎯 Language Profile file detected - syncing"
5. Verify file appears in SharePoint

### Test Scenario 3: Missing File
1. Change Language Status to "Active" (no file present)
2. Check webhook logs
3. Should see: "ℹ️ no_file - ignoring" (not an error, expected behavior)
4. No SharePoint upload occurs

---

## Monitoring

Watch real-time activity:
```bash
ssh root@154.66.196.129 'journalctl -u monday-webhook -f'
```

**Sample output:**
```
📨 WEBHOOK RECEIVED
Item: Project Alpha (ID: 123456789)
Language Status: Active
Has Language Profile: True
🎯 Language Profile file detected - syncing regardless of Language Status
📥 Step 1: Fetching file from Monday...
⬇️ Step 2: Downloading file...
🔐 Step 3: Authenticating with SharePoint...
📤 Step 4: Uploading to SharePoint...
✓ File uploaded successfully
✅ SYNC COMPLETE
```

---

## Troubleshooting

### Webhook doesn't fire
- Confirm automation is **ON** (toggle green)
- Confirm trigger condition matches (status exactly "Active", not similar)
- Check Monday automation editor shows no errors

### Webhook receives but doesn't sync
- Check logs: `journalctl -u monday-webhook -f`
- Confirm file exists in Language Profile column
- Confirm Language Status value is exactly "Active"

### File doesn't appear in SharePoint
- Check SharePoint folder path: `/sites/ActiveProjects/{PROJECT_NAME_UPPERCASE}/`
- Confirm folder name has no special characters
- Check SharePoint permissions (webhook user needs write access)
- Look for errors in logs

### API Authentication Failed
- Confirm `.env` has valid TENANT_ID, CLIENT_ID, CLIENT_SECRET
- Confirm app registration has `Sites.ReadWrite.All` permission
- Confirm permissions have admin consent

---

## Key Points

- **Webhook is event-driven** — Monday sends POST when conditions met
- **No polling** — doesn't check Monday continuously
- **File replacement** — always overwrites existing file in SharePoint
- **Dual triggers recommended** — covers both file changes and status changes
- **MOU metadata** — automatically set from "MOU End Date" column
- **Preferred endpoint for custom automations** — use `/monday/action` on Monday Code, not the old VPS `/sync-language-profile`

---

## VPS Service Info

```
Service: monday-webhook
Status: Active (running)
Port: 5000
Auto-restart: Yes (every 10s on crash)
Logs: journalctl -u monday-webhook -f
```

To restart: `ssh root@154.66.196.129 'systemctl restart monday-webhook'`

---

## Ready to Test?

Once automation is published and ON:
1. Make a change in Monday board (status or file)
2. Watch logs: `ssh root@154.66.196.129 'journalctl -u monday-webhook -f'`
3. Check SharePoint for file
4. Verify MOU date in folder metadata

Let me know results!
