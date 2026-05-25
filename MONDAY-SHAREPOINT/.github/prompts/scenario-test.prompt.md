---
description: "Run or generate scenario tests for the Monday → SharePoint webhook sync. Use when you want to test trigger logic, simulate webhook payloads, validate edge cases, or write pytest coverage for webhook_handler.py."
argument-hint: "Scenario to test: e.g. 'profile modified', 'status active no file', 'challenge verification', or 'all'"
agent: "agent"
tools: [run_in_terminal, read_file, create_file, replace_string_in_file]
---

You are testing the Monday → SharePoint webhook sync. The main logic lives in [webhook_handler.py](../../webhook_handler.py).

## Webhook Trigger Scenarios

These are the scenarios to exercise:

| # | Scenario | Trigger condition | Expected response |
|---|----------|-------------------|-------------------|
| 1 | Profile column modified, file present | `columnTitle` contains "Language Profile" + `file_has_value=True` | `success: true`, `trigger_reason: profile_column_modified` |
| 2 | Status → "Active", file present | `language_status == "Active"` + `file_has_value=True` | `success: true`, `trigger_reason: status_active_with_file` |
| 3 | Status → "Active", no file | `language_status == "Active"` + no file | `success: false`, `reason: no_file`, `action: ignore` |
| 4 | Status → non-"Active" | any status except "Active" | `success: false`, `reason: status_not_active`, `action: ignore` |
| 5 | Monday challenge (POST) | `{"challenge": "abc"}` in body | `{"challenge": "abc"}` |
| 6 | Monday challenge (GET) | `?challenge=abc` query param | `{"challenge": "abc"}` |
| 7 | Empty payload | `{}` | 400 or error |
| 8 | Missing `pulseId` | payload without item ID | `ValueError` / 400 |

## Integration Testing (live credentials required)

Use the diagnostic script for step-by-step isolation:

```bash
source .venv/bin/activate
python3 diagnose_sync.py <item_id> [FOLDER_NAME]
```

Use the system verifier to hit the live deployed endpoint:

```bash
source .venv/bin/activate
python3 verify_webhook_system.py
```

## What to do

Based on the argument provided (or "all" if none given), do ONE of the following:

**If running a specific integration scenario:** use `diagnose_sync.py` with a real Monday item ID and report each step's result.

**If generating unit tests:** create or update `tests/test_webhook_handler.py` using `pytest` + `unittest.mock`. Mock `get_item_column_details`, `get_asset_download_url`, `download_file`, `get_graph_token`, `get_sharepoint_site_id`, `get_site_drive_id`, `upload_file_to_sharepoint`, and `set_folder_metadata`. Do NOT make real network calls. Cover every row in the scenario table above.

**If asked for "all":** generate unit tests covering all 8 scenarios.

Follow the patterns in [CLAUDE.md](../../CLAUDE.md) for troubleshooting reference.
