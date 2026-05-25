# Automation Rebuild Guide — Lumen Africa EU Workspace

_Generated: 2026-05-18_

## Purpose

Monday.com's API **does not expose automation recipe configurations** — there is no
programmatic way to read or copy automations between accounts or datacenters.

This guide was generated from the **exported board schemas** of the 6 migrated boards.
It lists the most likely automation patterns for each board based on:
- Column types present (status, date, people, email, subtasks, numbers)
- Group structure
- Board purpose and naming

**⚠️ Important:** These are *inferred* suggestions, not extracted recipes.
Mark must compare these against the live US board automations before rebuilding in EU.

## How to Check US Automations

For each board in the US workspace (`seed-company-squad.monday.com`):
1. Open the board
2. Click the board name (top left) → **Automations**
3. Screenshot or note each active automation recipe
4. Compare against the suggestions below
5. Rebuild in the EU board using the same recipe

## Priority Legend

| Icon | Priority | Description |
|------|----------|-------------|
| 🔴 | High | Likely active — directly relates to core workflow |
| 🟡 | Medium | Probable — common pattern for this column combination |
| ⚪ | Low | Optional — nice-to-have or speculative |

---

## Email Template

**EU Board name:** Email Template (Files)
**Groups:** `Group Title`

### Column Schema

| Type | Title |
|------|-------|
| `file` | Files |

### Automations

_No automation patterns detected for this board (simple file repository — likely no automations needed)._

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## Email Template

**EU Board name:** Email Template (Campaigns)
**Groups:** `This week`, `Next week`, `Drafts`

### Column Schema

| Type | Title |
|------|-------|
| `people` | Sender |
| `status` | Status |
| `file` | Images/Documents |
| `file` | Documents to attach |
| `link` | Include Link |
| `people` | Recipient |
| `date` | Send on |

### Suggested Automations to Rebuild

> ⚠️ **Mark — please verify these against the US board's Automation settings**
> (Board menu → Automations) before rebuilding in EU.

| Priority | Trigger | Action | Monday Recipe |
|----------|---------|--------|---------------|
| 🔴 High | When "Status" changes to [specific label] | Notify "Sender" | `When status changes → notify person` |
| 🔴 High | When "Send on" arrives (or X days before) | Notify "Sender" | `When date arrives → notify person` |
| 🟡 Medium | 7 days before "Send on" | Notify "Sender" | `When date is approaching → notify person` |
| 🟡 Medium | When "Status" changes to Done/Sent/Complete | Move item to "Drafts" group | `When status changes → move item to group` |
| ⚪ Low | When item is created | Assign item to "Sender" | `When item is created → assign person` |

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## Event RSVP Process

**EU Board name:** Event RSVP Process
**Groups:** `Registrants`, `Internal Staff RSVP`

### Column Schema

| Type | Title |
|------|-------|
| `email` | Email |
| `text` | Company Name |
| `status` | Company Size |
| `text` | Title |
| `phone` | Phone Number |
| `text` | Note from RSVP |
| `dropdown` | Preferences |
| `status` | Status |
| `date` | Reminder Date |
| `status` | Did they attend? |

### Suggested Automations to Rebuild

> ⚠️ **Mark — please verify these against the US board's Automation settings**
> (Board menu → Automations) before rebuilding in EU.

| Priority | Trigger | Action | Monday Recipe |
|----------|---------|--------|---------------|
| 🔴 High | When "Reminder Date" arrives | Send email to "Email" | `When date arrives → send email` |
| 🟡 Medium | When item is created | Send confirmation email to "Email" | `When item is created → send email (confirmation)` |
| 🟡 Medium | When "Company Size" changes to Done/Sent/Complete | Move item to "Internal Staff RSVP" group | `When status changes → move item to group` |

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## Event Planning Checklist

**EU Board name:** Event Planning Checklist
**Groups:** `Group Title`

### Column Schema

| Type | Title |
|------|-------|
| `file` | Files |

### Automations

_No automation patterns detected for this board (simple file repository — likely no automations needed)._

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## Event Planning

**EU Board name:** Event Planning
**Groups:** `Kickoff`, `Event Sessions & Topics`, `Vendors Needed`, `Campaigns for event`

### Column Schema

| Type | Title |
|------|-------|
| `subtasks` | Subitems |
| `people` | Organizer |
| `people` | Finance |
| `date` | Deadline |
| `numbers` | Budget Spent |
| `numbers` | Budget |
| `status` | Status |
| `status` | Campaign Channel |

### Suggested Automations to Rebuild

> ⚠️ **Mark — please verify these against the US board's Automation settings**
> (Board menu → Automations) before rebuilding in EU.

| Priority | Trigger | Action | Monday Recipe |
|----------|---------|--------|---------------|
| 🔴 High | When "Status" changes to [specific label] | Notify "Organizer" | `When status changes → notify person` |
| 🟡 Medium | When "Campaign Channel" changes to [specific label] | Notify "Organizer" | `When status changes → notify person` |
| 🔴 High | When "Deadline" arrives (or X days before) | Notify "Organizer" | `When date arrives → notify person` |
| 🟡 Medium | 7 days before "Deadline" | Notify "Organizer" | `When date is approaching → notify person` |
| 🟡 Medium | When "Status" changes to Done/Sent/Complete | Move item to "Campaigns for event" group | `When status changes → move item to group` |
| 🟡 Medium | When "Budget Spent" exceeds "Budget" | Notify "Organizer" _(Monday does not natively compare two number columns — may require a formula column workaround)_ | `When number exceeds another number → notify person` |
| 🔴 High | When all subitems are marked Done | Change parent item Status to Done | `When all subitems are done → change parent status` |
| ⚪ Low | When parent item Status changes | Change all subitems Status to match | `When status changes → change subitem status` |
| ⚪ Low | When item is created | Assign item to "Organizer" | `When item is created → assign person` |

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## Subitems of Event Planning

**EU Board name:** Subitems of Event Planning
**Groups:** `Subitems`

### Column Schema

| Type | Title |
|------|-------|
| `people` | Owner |
| `status` | Status |
| `date` | Due Date |
| `file` | Files |

### Suggested Automations to Rebuild

> ⚠️ **Mark — please verify these against the US board's Automation settings**
> (Board menu → Automations) before rebuilding in EU.

| Priority | Trigger | Action | Monday Recipe |
|----------|---------|--------|---------------|
| 🔴 High | When "Status" changes to [specific label] | Notify "Owner" | `When status changes → notify person` |
| 🔴 High | When "Due Date" arrives (or X days before) | Notify "Owner" | `When date arrives → notify person` |
| 🟡 Medium | 7 days before "Due Date" | Notify "Owner" | `When date is approaching → notify person` |
| ⚪ Low | When item is created | Assign item to "Owner" | `When item is created → assign person` |

### Steps to Rebuild in EU

1. Open the board in EU workspace 5927902
2. Click the board name → **Automate** (or Board menu → Automations)
3. Click **+ Add automation** and search by recipe name above
4. Configure the trigger column, values, and notification recipients
5. Test with a dummy item before going live

---

## General Monday.com Automation Reference

Common recipes used in Lumen Africa's boards:

| Recipe | Monday search term |
|--------|--------------------|
| When status changes → notify person | "When status changes, notify someone" |
| When date arrives → notify person | "When date arrives, notify someone" |
| When date is approaching → notify | "When date is approaching, notify someone" |
| When item is created → notify | "When an item is created, notify someone" |
| When status changes → move item | "When status changes, move item to group" |
| When all subitems done → update parent | "When all subitems are done, change parent status" |
| When date arrives → send email | "When date arrives, send email" |

## EU Workspace Reference

- **Workspace ID:** 5927902
- **Account:** Luminafrica NPC (EU datacenter)
- **URL:** `https://luminafrica.monday.com` (or your EU subdomain)

People column values will remain empty until the SC → EU user mapping is confirmed.
Rebuild automations with placeholders and update recipients once users are in EU.