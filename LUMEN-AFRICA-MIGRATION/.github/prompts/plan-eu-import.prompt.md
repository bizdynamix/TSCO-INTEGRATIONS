---
mode: agent
description: Plan and build the live EU import for Lumen Africa. Use when starting a session to execute the EU import, fill credentials, or build import-board.js from dry-run to live.
---

You are working on the Lumen Africa Monday.com migration. Phase 1 is complete — all 6 boards have been exported from the SC US instance. EU access is now available.

## Session Goal

Build and run the **live EU import**. The dry-run plan is at `reports/import-plan.json`. The import scaffold is at `scripts/import-board.js`.

## Step 1 — Verify Credentials

Check `monday-secret.json`:
- Is `MONDAY_API_TOKEN_EU` filled in?
- Is `MONDAY_WORKSPACE_ID_EU` filled in?

If either is empty, ask the user for the values before proceeding.

## Step 2 — Inspect the Current Import Script

Read `scripts/import-board.js` and `scripts/lib.js`. Understand what's already implemented vs what's stubbed.

## Step 3 — Identify What Needs Building

Based on `reports/import-plan.json`, determine what's missing from the live import:
- Board creation
- Group creation
- Column creation (per import strategy in AGENTS.md)
- Item creation (with column value mapping)
- File upload via `add_file_to_column`
- Subitems

## Step 4 — Build

Extend `scripts/import-board.js` to execute live API calls against the EU instance. Key rules:
- Use `MONDAY_API_TOKEN_EU` from `loadSecret()`
- Target EU workspace: `MONDAY_WORKSPACE_ID_EU`
- No hardcoded column IDs — always resolve from board schema
- Add 450ms delay between requests (EU rate limit)
- Skip `people` columns until user mapping is provided — create the column but leave values empty
- Skip `board-relation`, `mirror`, `formula` — log as manual follow-up

## Step 5 — Dry-Run First

Run `npm run import:dry` against one small board before live execution. Confirm the plan looks right.

## Step 6 — Live Run

Execute import for all 6 boards. Log progress. Write results to `reports/import-results.json`.

## Step 7 — Validate

Compare item counts between `data/board-*.json` (source) and live EU board (via API). Report discrepancies.

---

Refer to [AGENTS.md](../../AGENTS.md) for column strategies, API quirks, and rate limit details.
