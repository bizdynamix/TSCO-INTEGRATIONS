# Simple Webhook Setup (Just Do This)

> Note (May 2026): Do not use this as end-user onboarding. We do not want users pasting webhook URLs into Monday Vibe. The supported setup is Monday Workflow Builder with the app's action block.

## 3 Steps in Monday

This is the direct board automation path for internal debugging only.

### Step 1: Go to Board
Open: https://seed-company-squad.monday.com/boards/18409984885

### Step 2: Click Automation
Click the **wrench icon** (top right) → **Create automation**

### Step 3: Copy & Paste This (Internal Debug Only)

**When:** Status changes to specific status  
**Column:** Language Status  
**Value:** Active

**Then:** Make an API call (internal debug only)

**In the webhook form, paste exactly this:**

```
Method: POST
URL: https://a7673-service-12597801-ef203e65.us.monday.app/monday/action
```

**Then click "Body" tab and paste this entire JSON block:**

```json
{
  "itemId": {item_id}
}
```

**Click Publish** → Toggle **ON**

---

## Done

That's it. When someone sets a project to "Active" status, Monday calls the live app and the file syncs to SharePoint automatically.

---

## To Test

Change any project's status to "Active" in Monday.

Then run:
```bash
ssh root@154.66.196.129 'journalctl -u monday-webhook -f'
```

You should see confirmation in the logs within 2 seconds.
