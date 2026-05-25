# How to Find Vibe Automation in Monday

> Note (May 2026): Finding this panel is useful for debugging, but it is not the intended user setup path for this project. We do not want users pasting webhook URLs into a manual Vibe action. The supported path is a native app/plugin recipe or workflow template installed from Monday's Automations or Integrations browser.

## Location in Monday UI

### Step 1: Open the Board
Go to: https://seed-company-squad.monday.com/boards/18409984885

(You'll see the project/item board)

### Step 2: Find the Automation Icon

**Look at the TOP-RIGHT corner of the board.**

You'll see these icons in order:
- 👁️ View options
- ⚙️ Settings  
- **🔧 Wrench (This is Automation)**

**Click the wrench icon**

### Step 3: Automation Panel Opens

A right-side panel appears showing:
- "Automations" header
- **"Create automation"** button

**Click "Create automation"**

### Step 4: Automation Builder Opens

You're now in the Vibe Automation builder. You'll see:

```
WHEN [dropdown]
THEN [dropdown]
[+ Add condition button]
```

---

## Visual Reference

```
Board Header (Top Right Corner):
┌─────────────────────────────────────┐
│ ... | 👁️ | ⚙️ | 🔧 WRENCH HERE |
└─────────────────────────────────────┘
       (click this one)
                    ↓
         [Automations panel opens]
                    ↓
         "Create automation" button
                    ↓
         [Vibe builder form appears]
```

---

## If You Don't See the Wrench

**Try this:**
1. Look for a menu icon (≡) in top-right
2. Click it
3. Look for "Automations" option
4. Click that instead

**Or:**
1. Click your workspace name (top-left)
2. Look for "Automations" in the left sidebar
3. Click it

---

## Once in the Builder

If you are debugging the manual fallback, you'll see blanks to fill:

```
WHEN: [dropdown] → select "Status changes to specific status"
      [dropdown] → select "Language Status"
      [dropdown] → select "Active"

THEN: [dropdown] → select "Make an API call" (internal debug only)
      [text field] → paste webhook URL (internal debug only)
      [JSON body] → paste the JSON payload
```

---

## Done?

Once you can see the "Create automation" button, you're in the right place. Let me know if you get stuck!
