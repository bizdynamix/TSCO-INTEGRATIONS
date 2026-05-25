# Monday Workflow Blocks Setup Guide

> Note (May 2026): This is the preferred user-facing setup. Do not direct end users to paste raw webhook URLs into Monday Vibe "Make an API call" actions, and do not build new setup around legacy recipe sentences. The supported experience is Monday Workflow Builder with app-owned blocks.

## What This Does

Exposes the SharePoint sync as a **native Monday workflow action block** that users add inside Monday's Automations or Workflow Builder UI.

**Target workflow in Monday:**
> When *Language Status* changes to *Active* → *Sync Language Profile to SharePoint*

That is a block composition inside Monday's builder, not a custom sentence template we own.

## Recommended Shape For This Repo

Use Monday's **native status-changed trigger** and wire it into our app's **action block**.

Why this is the right fit here:
- The business trigger is standard Monday behavior: a status column changes to `Active`.
- Our backend already implements the action block contract at `POST /monday/action`.
- A fully custom app-owned trigger would require durable subscription storage plus outbound event delivery back to Monday. This repo does **not** implement that full trigger engine today.

The existing `POST /monday/subscribe` and `POST /monday/unsubscribe` endpoints should be treated as workflow lifecycle/challenge endpoints, not proof that a full custom trigger block is complete.

---

## What Was Added to the Codebase

| File | Change |
|------|--------|
| `webhook_handler.py` | Workflow lifecycle endpoints plus the action execution route |
| `monday.json` | App metadata and older feature wiring; do not use the legacy recipe stanza as the target design for new setup |

### New Endpoints

| Route | Purpose |
|-------|---------|
| `POST /monday/subscribe` | Workflow lifecycle verification / subscription callback |
| `POST /monday/unsubscribe` | Workflow lifecycle cleanup callback |
| `POST /monday/action` | Action block execution endpoint — runs the SharePoint sync |

---

## Step 1: Deploy the Updated Code

```bash
cd /path/to/monday-sharepoint
APP_ID=11375832
DRAFT_VERSION_ID=14891922

mapps code:push -d . -i "$DRAFT_VERSION_ID"
mapps code:status -i "$DRAFT_VERSION_ID"
```

Current draft version for workflow-block work: `14891922`

Current draft URL at the time of writing: `https://ed794-service-12597801-e1067fa2.us.monday.app`

Verify the new routes are live:
```bash
curl https://ed794-service-12597801-e1067fa2.us.monday.app/monday/subscribe \
  -X POST -H "Content-Type: application/json" \
  -d '{"challenge": "test123"}'
# Expected: {"challenge": "test123"}
```

---

## Step 2: Configure Workflow Blocks In Monday Developer Center

1. Go to **https://monday.com/apps/manage** → select **Monday Sharepoint Transporter** (App ID `11375832`)
2. Add the current workflow/integration-block feature Monday exposes for apps
3. Attach the correct **Monday Code deployment** to the feature before publishing

Current remote feature state:
- Draft `14891922` contains the workflow-block setup: block `21457027` and workflow template `21457002`
- Live `14890033` still contains the older integration feature: `21456222`

### Configure the Action Block

Create or update an **Action** block:

| Field | Value |
|-------|-------|
| Block ID | `syncLanguageProfile` |
| Name | `Sync Language Profile to SharePoint` |
| Execution URL | `https://ed794-service-12597801-e1067fa2.us.monday.app/monday/action` |
| Timeout | 60 seconds |

**Input fields:**
- `itemId` — required
- `boardId` — optional if your chosen Monday trigger exposes it; the backend only requires `itemId`

**Payload contract accepted by the backend:**

Preferred workflow-block shape:

```json
{
        "inboundFieldValues": {
                "itemId": "12345",
                "boardId": "18409984885"
        }
}
```

Legacy fallback still supported:

```json
{
        "payload": {
                "inputFields": {
                        "itemId": "12345",
                        "boardId": "18409984885"
                }
        }
}
```

### Workflow Composition In Monday

Inside Monday's workflow builder on the board:

1. Choose Monday's native **status changed** trigger
2. Map **Language Status** as the column
3. Set the target value to **Active**
4. Add the app action block **Sync Language Profile to SharePoint**
5. Map `itemId` from the trigger output into the action block input
6. Map `boardId` too if the trigger exposes it, though it is not required by this backend

### Optional: App-Owned Trigger Block

Only build a custom trigger block if Monday's native trigger cannot express the workflow you need. If you go down that path, `POST /monday/subscribe` and `POST /monday/unsubscribe` are the lifecycle endpoints to register, but you must also implement:
- durable storage for subscriptions
- outbound delivery to Monday's workflow webhook URL when the trigger condition occurs
- a trigger output contract that supplies `itemId` to the action block

That outbound trigger engine is not implemented in this repo today.

If Monday asks you for lifecycle URLs while configuring app-owned trigger infrastructure, use:

| Field | URL |
|-------|-----|
| Subscribe URL | `https://ed794-service-12597801-e1067fa2.us.monday.app/monday/subscribe` |
| Unsubscribe URL | `https://ed794-service-12597801-e1067fa2.us.monday.app/monday/unsubscribe` |

---

## Step 3: Publish the App Version

In the developer dashboard:
1. Publish the app version that contains the block configuration
2. Confirm the workflow feature is attached to the active deployment
3. Keep visibility private/internal unless there is a reason to broaden it

---

## Step 4: Add The Workflow On The Board

1. Open the target board (e.g., `18409984885`)
2. Open **Automations** / **Workflow Builder**
3. Search for **Monday Sharepoint Transporter**
4. Add the app's **Sync Language Profile to SharePoint** action block
5. Use Monday's native status-change trigger as the first block
6. Set **Language Status** → `Active`
7. Publish the workflow and toggle it on

---

## How the Flow Works (Post-Setup)

```
User sets Language Status = "Active"
        ↓
Monday fires its native status-changed trigger
                                ↓
Monday Workflow Builder maps trigger output fields
        ↓
Monday calls POST /monday/action
        { inboundFieldValues: { itemId: "...", boardId: "..." } }
        ↓
webhook_handler.py fetches item details from Monday API
        ↓
Downloads Language Profile file
        ↓
Uploads to SharePoint /sites/ActiveProjects/{PROJECT_NAME_UPPERCASE}/
        ↓
Sets MOUenddate0 metadata
        ↓
Returns { success: true, sharepoint_url: "..." }
```

---

## Troubleshooting

**Action block not appearing in Workflow Builder:**
- Make sure the app version is published
- Make sure the block feature is attached to the deployed Monday Code version
- Check that you created blocks, not only legacy sentence/recipe metadata

**Action returns 400 Missing itemId:**
- Verify the workflow maps `itemId` from the trigger output into the action block input
- Check the block configuration and deployment attachment

**Challenge verification failing at subscribe:**
- Monday sends `{"challenge": "..."}` when verifying the URL — handler already responds correctly
- Test manually: `curl -X POST .../monday/subscribe -d '{"challenge":"abc"}'`

**You want a fully custom trigger block:**
- Stop treating `subscribe` and `unsubscribe` as sufficient on their own
- Implement persistent subscription storage plus outbound event delivery to Monday before documenting that path as complete
