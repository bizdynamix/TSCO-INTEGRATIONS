# Monday Vibe Automation Setup — Language Profile Sync

> Note (May 2026): Do not use manual Vibe "Make an API call" steps with a pasted webhook URL as the end-user setup path. The supported experience is a native Monday app/plugin feature that users add from the Automations or Integrations browser. Keep this document only as an internal fallback for debugging or temporary verification.

This guide walks through the manual fallback path that:
- **Triggers** when a project's status changes to "Active"
- **Calls the live Monday Code action endpoint** from the board's Automations builder
- **Lets the app fetch item details itself** and sync to SharePoint

## Prerequisites

1. **Automation Endpoint**: Monday Code action endpoint at `https://a7673-service-12597801-ef203e65.us.monday.app/monday/action`
  - See [`webhook_handler.py`](./webhook_handler.py) for implementation
  - Environment variables configured in Monday Code secrets

2. **Monday Board**: Board ID `8445065255` with columns:
   - Item Name (Text) — Project name
   - Project Status (Status/Dropdown) — with "Active" value
   - Language Profile (File) — attachment column
   - FPM (Person/User) — who to notify
   - MOU End Date (Date) — metadata for SharePoint
   - Updates (Updates) — for @mention notifications

## Setup Steps

### 1. Open Vibe Automation Builder

**Monday UI Path:**
```
Board 8445065255 
  → Automation (wrench icon, top-right)
  → Create automation
  → Choose: "When" + "Then" (workflow builder)
```

### 2. Add Trigger: Status Changes to "Active"

**In Vibe Builder:**
- **Trigger Type:** `When a status changes to a specific status`
- **Column:** Project Status
- **Status Value:** Active
- **Logic:** Run every time (no "only if" conditions yet)

```
[Trigger] When "Project Status" changes to "Active"
```

### 3. Add Action: Make an API Call (Internal Debug Only)

**Vibe Action (internal debug only):**
```
→ Then: "Make an API call"
  → Method: POST
  → URL: https://a7673-service-12597801-ef203e65.us.monday.app/monday/action
  → Headers:
       Content-Type: application/json
  → Body (JSON):
    {
      "itemId": {item_id}
    }
```

### 4. Webhook Response & Follow-Up

The `webhook_handler.py` will:
1. Receive POST from Monday automation
2. Fetch full item details from Monday API
3. Download Language Profile file from Monday
4. Create/verify SharePoint folder (UPPERCASE project name)
5. Upload file to SharePoint
6. Set MOU End Date metadata
7. Return JSON: `{"success": true, "sharepoint_url": "..."}`

---

## Configuration Reference

### Column Mapping (Expected)

| Monday Column | Type | Purpose | Webhook Param |
|---|---|---|---|
| Item Name | Text | Project name | fetched by app |
| Project Status | Status | Trigger value | handled by Monday trigger |
| Language Profile | File | PDF/Word doc | fetched by app |
| FPM | Person | Language Project Manager | optional for board updates |
| MOU End Date | Date | Contract end | fetched by app |
| Updates | Updates | Notifications | — |

### Vibe Variables (Monday Syntax)

Use these placeholders in Vibe automation text:
```
{item_id}              — Unique item ID
{item.name}            — Project name from Name column
{FPM}                  — FPM user object
{FPM.id}               — FPM user ID
{MOU End Date}         — Date value
{Language Profile}     — File column data (if checking)
```

### Monday Update @Mentions

To tag users in updates:
```
"@{FPM} Your message here"      — Tags FPM by object reference
"@Field_IT_Analyst@tsco.org"    — Tags by email (if discoverable)
```

---

## Testing the Automation

### Test Scenario 1: With Language Profile File

1. Find or create a project item with:
   - Status = "Active"
   - Language Profile = (upload any PDF)
   - FPM = (assign someone)

2. Verify:
   - ✅ Vibe automation triggers
  - ✅ POST sent to Monday Code action endpoint
   - ✅ File downloaded and uploaded to SharePoint
  - ✅ App returns success JSON

### Test Scenario 2: Without Language Profile File

1. Create a project item with:
   - Status = "Active"
   - Language Profile = (empty/no file)
   - FPM = (assign someone)

2. Verify:
   - ✅ Vibe automation triggers
  - ✅ App returns `no_file`
  - ✅ No SharePoint upload occurs

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook never called | Status not changing to "Active" | Manually set status or create new item with status=Active |
| 404/503 error | Wrong URL or stale deployment | Use the exact Monday Code `/monday/action` URL above |
| File not uploading to SharePoint | Auth token expired or folder creation failed | Check `.env` credentials, review Flask logs |
| @FPM mention not showing | FPM column empty or wrong type | Ensure FPM is Person/User column, assign user to item |
| Duplicate files in SharePoint | Multiple automation runs | Check Monday automation logs for duplicate triggers |

---

## Deployment

1. **Deploy code to Monday Code** and keep the app version live.

2. **Configure Monday Vibe automation** (steps above)

3. **Test with dry-run** scenario above

4. **Monitor:**
   - Flask logs for webhook requests
   - SharePoint for uploaded files
   - Monday updates for @FPM notifications

---

## API Payload Format (What Monday Sends)

The webhook receives JSON POST:
```json
{
  "action_type": "webhook",
  "trigger": {
    "type": "status_change",
    "board_id": 8445065255,
    "item_id": 123456,
    "column_id": "status_column_id",
    "value": "Active"
  },
  "item": {
    "name": "Project Name",
    "id": 123456
  },
  "column_values": [
    {
      "id": "language_profile_column_id",
      "title": "Language Profile",
      "type": "file",
      "text": "[asset_data]"
    },
    {
      "id": "fpm_column_id",
      "title": "FPM",
      "type": "people",
      "value": {"id": 987654, "email": "..."}
    },
    {
      "id": "mou_end_date_column_id",
      "title": "MOU End Date",
      "type": "date",
      "text": "2026-12-31"
    }
  ]
}
```

See [`webhook_handler.py`](./webhook_handler.py) for parsing logic.

---

## Next Steps

1. Deploy `webhook_handler.py` to accessible endpoint
2. Follow setup steps above in Monday UI
3. Test with both scenarios (with/without file)
4. Monitor logs and iterate on notification messages
5. Archive or delete completed items to keep board clean
