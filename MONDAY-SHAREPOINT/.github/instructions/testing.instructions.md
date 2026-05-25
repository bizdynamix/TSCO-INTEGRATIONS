---
description: "Use when writing, running, or debugging tests for webhook_handler.py. Covers unit test patterns, mock targets, scenario table, and integration test commands."
applyTo: "tests/**/*.py"
---

# Testing Guidelines — Monday → SharePoint Webhook

## Unit Tests

**Framework:** `pytest` + `unittest.mock`  
**Location:** `tests/test_webhook_handler.py`  
**Run:** `source .venv/bin/activate && pytest tests/ -v`

### Functions to mock (always patch at the handler module level)

```python
from unittest.mock import patch, MagicMock

# Patch targets (use these exact strings):
"webhook_handler.get_item_column_details"
"webhook_handler.get_asset_download_url"
"webhook_handler.download_file"
"webhook_handler.get_graph_token"
"webhook_handler.get_sharepoint_site_id"
"webhook_handler.get_site_drive_id"
"webhook_handler.upload_file_to_sharepoint"
"webhook_handler.set_folder_metadata"
```

> **Important:** Do NOT use stacked `@patch` decorators on functions that also take pytest fixtures — pytest treats all parameters as fixture names and raises `fixture 'mock_x' not found`. Use `with patch(...) as mock_x:` context managers inside the test body instead.

### Flask test client setup

```python
import pytest
from webhook_handler import app

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
```

### Canonical payload shape

```python
VALID_PAYLOAD = {
    "event": {
        "pulseId": 12345,
        "pulseName": "TEST PROJECT",
        "boardId": 18409984885,
        "columnTitle": "Language Status",
        "value": {"label": {"text": "Active"}},
    }
}
```

For **profile_column_modified** trigger, set `"columnTitle": "Language Profile"`.

### Scenario coverage required — `/sync-language-profile` (Vibe path)

| Test name | `col_details` mock | `columnTitle` | Expected JSON key |
|-----------|-------------------|---------------|-------------------|
| `test_profile_modified_with_file` | `file_has_value=True` | `"Language Profile"` | `trigger_reason: profile_column_modified` |
| `test_status_active_with_file` | `file_has_value=True` | `"Language Status"`, value `"Active"` | `trigger_reason: status_active_with_file` |
| `test_status_active_no_file` | `file_has_value=False` | `"Language Status"`, value `"Active"` | `reason: no_file` |
| `test_status_not_active` | any | value `"Inactive"` | `reason: status_not_active` |
| `test_challenge_post` | — | — | `challenge` echo |
| `test_challenge_get` | — | `?challenge=abc` | `challenge` echo |
| `test_empty_payload` | — | — | 400 |

### Scenario coverage required — `/monday/action` (Workflow Action path)

`/monday/action` receives only `itemId` + optional `boardId` — it has **no column values in the payload** and must call `get_item_column_details()`.

```python
def make_action_payload(item_id=12345, board_id=18409984885, payload_shape="workflow"):
    field_values = {"itemId": str(item_id), "boardId": str(board_id)}
    if payload_shape == "workflow":
        return {"inboundFieldValues": field_values}
    if payload_shape == "workflow_nested":
        return {"payload": {"inboundFieldValues": field_values}}
    return {"payload": {"inputFields": field_values}}
```

| Test name | `col_details` mock | Expected JSON key |
|-----------|-------------------|-------------------|
| `test_action_supported_payload_shapes` | `file_has_value=True` | `success: true`, `sharepoint_url` present for workflow and legacy payload shapes |
| `test_action_no_file` | `file_has_value=False` | `reason: no_file` |
| `test_action_missing_item` | returns `{}` | 404 |
| `test_action_challenge` | — | `challenge` echo |

Use the same `SYNC_PATH` mock list as the Vibe tests (all 8 targets) for the happy-path action test.

### Scenario coverage required — Subscribe/Unsubscribe lifecycle

| Endpoint | Test | Expected |
|----------|------|----------|
| `POST /monday/subscribe` | valid payload | `{"webhookId": "<uuid>"}`, 200 |
| `POST /monday/subscribe` | challenge | `{"challenge": "..."}`, 200 |
| `POST /monday/unsubscribe` | valid `webhookId` | `{"result": "unsubscribed"}`, 200 |
| `POST /monday/unsubscribe` | challenge | `{"challenge": "..."}`, 200 |

## Integration Testing

Always activate the venv first:

```bash
source .venv/bin/activate
```

| Command | When to use |
|---------|-------------|
| `python3 diagnose_sync.py <item_id>` | Step-by-step Monday + SharePoint isolation |
| `python3 diagnose_sync.py <item_id> FOLDER` | Same, writing to a named test folder |
| `python3 verify_webhook_system.py` | Full end-to-end against live deployed URL |
| `curl -X POST 'https://ed794-service-12597801-e1067fa2.us.monday.app/monday/action' -H 'Content-Type: application/json' -d '{"inboundFieldValues":{"itemId":"11832064528","boardId":"18409984885"}}'` | Quick draft workflow-block smoke test with a known item |

Test board ID: `18409984885`, test item IDs documented in [CLAUDE.md](../../CLAUDE.md).

## Common Pitfalls

- Mock `Path.stat()` and `Path.unlink()` if testing cleanup steps
- The webhook checks `"Language Profile" in trigger_column` (substring match, not exact)
- `language_status` comes from `event.value.label.text` — mock accordingly
- `file_column_id` must be non-None for sync to proceed, even when `file_has_value=True`
