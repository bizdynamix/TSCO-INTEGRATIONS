# Monday Vibe Automation Setup — Language Profile → SharePoint

> Note (May 2026): Direct Vibe workflows that paste `/monday/action` are not the desired user-facing setup. The supported product direction is a native Monday app/plugin feature that users add from the Automations or Integrations browser. Keep this document only for internal fallback testing.

## Webhook Endpoint (Live)

```
https://a7673-service-12597801-ef203e65.us.monday.app/monday/action
```

---

## Triggers

The webhook accepts **TWO independent triggers**:

### **Trigger 1: Language Profile File Modified**
- **When:** Any change to Language Profile column (file added/replaced/removed)
- **Check:** If file exists → sync immediately
- **Status Required:** NO (triggers regardless of Language Status)

### **Trigger 2: Language Status Changes to Active**
- **When:** Language Status column changes to "Active"
- **Check:** If file exists → sync immediately
- **If No File:** Ignore (wait for file to be added)

---

## Setup in Monday Vibe

### **Method 1: Single Automation with Dual Triggers**

1. **Open Board 18409984885** → Automation (wrench icon)
2. **Create automation** → Workflow builder
3. **Add First Trigger:**
   - When: `When status changes to specific status`
   - Column: `Language Status`
   - Value: `Active`

4. **Add Second Trigger (OR):**
   - When: `When column value changes`
   - Column: `Language Profile`
   - Link with: `OR` (not AND)

5. **Add Condition:**
   ```
   If: Language Profile
   Condition: "has a value"
   ```

6. **Then: Call Webhook**
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

7. **Then: Notify FPM (Optional)**
   ```
   Create an update:
   Text: "@{FPM} Syncing Language Profile to SharePoint... ⏳"
   ```

8. **Publish** → Toggle ON

---

### **Method 2: Two Separate Automations**

Create **Automation #1:**
```
When: Status changes to "Active"
If: Language Profile has a value
Then: Call webhook
```

Create **Automation #2:**
```
When: Language Profile column changes
If: Language Profile has a value
Then: Call webhook
```

(Use Method 2 if single automation gets too complex)

---

## Testing Checklist

### **Test 1: File Change Trigger**
- [ ] Pick a project with Language Status NOT "Active"
- [ ] Add or replace Language Profile file
- [ ] Webhook should trigger and sync to SharePoint
- [ ] Check logs: `journalctl -u monday-webhook -f`
- [ ] Verify file in SharePoint: `/sites/ActiveProjects/{PROJECT_NAME_UPPERCASE}/`

### **Test 2: Status Change Trigger**
- [ ] Pick a project WITH Language Profile file
- [ ] Change Language Status to "Active"
- [ ] Webhook should trigger and sync to SharePoint
- [ ] Verify Monday update: "@FPM Syncing..." appears
- [ ] Verify file in SharePoint

### **Test 3: Status Change WITHOUT File**
- [ ] Pick a project WITHOUT Language Profile file
- [ ] Change Language Status to "Active"
- [ ] Webhook should trigger but ignore (no file)
- [ ] Check logs: should show `"reason": "no_file"`, `"action": "ignore"`
- [ ] No error, just waits

---

## Webhook Response

### **Success (Synced)**
```json
{
  "success": true,
  "project_name": "PROJECT NAME",
  "item_id": 12345,
  "trigger_reason": "profile_column_modified",
  "sharepoint_url": "https://seedcompany.sharepoint.com/sites/ActiveProjects/PROJECT%20NAME/filename.pdf",
  "notification": "✅ synced"
}
```

### **Ignored (No File)**
```json
{
  "success": false,
  "project_name": "PROJECT NAME",
  "item_id": 12345,
  "reason": "no_file",
  "action": "ignore"
}
```

### **Ignored (Status Not Active)**
```json
{
  "success": false,
  "project_name": "PROJECT NAME",
  "item_id": 12345,
  "reason": "status_not_active",
  "action": "ignore"
}
```

---

## Monitoring & Troubleshooting

### **View Real-Time Logs**
```bash
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'journalctl -u monday-webhook -f'
```

### **Check Service Status**
```bash
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'systemctl status monday-webhook'
```

### **Restart Service**
```bash
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'systemctl restart monday-webhook'
```

### **Last 50 Log Lines**
```bash
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'journalctl -u monday-webhook -n 50 --no-pager'
```

### **Find Sync Events**
```bash
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'journalctl -u monday-webhook | grep "🎯"'
```

---

## File Replacement Behavior

- Files are **always replaced** in SharePoint (PUT method)
- If file exists with same name → overwritten
- If file is new → created
- No version conflicts or duplicates
- MOU End Date metadata is set/updated each time

---

## Environment (.env on VPS)

Located at: `/var/www/webhook-handler/.env`

Required variables:
```
MONDAY_API_TOKEN=...
TENANT_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
SHAREPOINT_HOSTNAME=seedcompany.sharepoint.com
SHAREPOINT_SITE_PATH=/sites/ActiveProjects
FLASK_PORT=5000
FLASK_HOST=0.0.0.0
```

---

## Rollback / Troubleshooting

### **Webhook Not Triggering**
1. Check Automation is Published and ON (toggle)
2. Verify URL is exactly: `https://a7673-service-12597801-ef203e65.us.monday.app/monday/action`
3. Check Monday Code logs for the live app version
4. Test with curl: `curl -X POST https://a7673-service-12597801-ef203e65.us.monday.app/monday/action -H 'Content-Type: application/json' -d '{"challenge":"test123"}'`

### **Service Crashed**
```bash
# Restart
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'systemctl restart monday-webhook'

# Check logs for errors
sshpass -p 'VIVO@2026#' ssh root@154.66.196.129 'journalctl -u monday-webhook -n 100'
```

### **File Not Syncing**
1. Check Language Profile file exists in Monday
2. Check FPM column is populated
3. Check webhook logs for error messages
4. Verify SharePoint credentials (.env variables)

---

## Next Steps

1. ✅ Webhook deployed and running on POWRSPORT VPS
2. ⏳ Configure Monday Vibe automation (see steps above)
3. ⏳ Test all 3 scenarios (file change, status change, missing file)
4. ⏳ Monitor logs and refine as needed
5. ⏳ Enable for production use
