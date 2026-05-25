"""
Scenario tests for webhook_handler.py — all 8 trigger scenarios.

Run:
    source .venv/bin/activate
    pytest tests/test_webhook_handler.py -v
"""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from webhook_handler import app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_payload(column_title="Language Status", status_text="Active",
                 pulse_id=12345, pulse_name="TEST PROJECT"):
    return {
        "event": {
            "pulseId": pulse_id,
            "pulseName": pulse_name,
            "boardId": 18409984885,
            "columnTitle": column_title,
            "value": {"label": {"text": status_text}},
        }
    }


def make_action_payload(item_id=12345, board_id=18409984885, payload_shape="workflow"):
    field_values = {"itemId": str(item_id), "boardId": str(board_id)}
    if payload_shape == "workflow":
        return {"inboundFieldValues": field_values}
    if payload_shape == "workflow_nested":
        return {"payload": {"inboundFieldValues": field_values}}
    if payload_shape == "legacy":
        return {"payload": {"inputFields": field_values}}
    raise ValueError(f"Unsupported payload_shape: {payload_shape}")


def col_details_mock(has_file=True, file_column_id="files0", mou_end_date="2027-06-30"):
    return {
        "file_column_id": file_column_id if has_file else None,
        "file_has_value": has_file,
        "mou_end_date": mou_end_date,
    }


def action_col_details_mock(item_name="TEST PROJECT", has_file=True,
                            file_column_id="files0", mou_end_date="2027-06-30"):
    return {
        "item_name": item_name,
        "file_column_id": file_column_id if has_file else None,
        "file_has_value": has_file,
        "mou_end_date": mou_end_date,
    }


def fake_local_path():
    p = MagicMock(spec=Path)
    p.name = "Language_Profile.pdf"
    p.stat.return_value.st_size = 4096
    return p


SYNC_PATH = [
    "webhook_handler.get_item_column_details",
    "webhook_handler.get_asset_download_url",
    "webhook_handler.download_file",
    "webhook_handler.get_graph_token",
    "webhook_handler.get_sharepoint_site_id",
    "webhook_handler.get_site_drive_id",
    "webhook_handler.upload_file_to_sharepoint",
    "webhook_handler.set_folder_metadata",
]


def apply_happy_path(mocks):
    """Configure all sync mocks for a successful upload."""
    mocks[0].return_value = col_details_mock(has_file=True)          # get_item_column_details
    mocks[1].return_value = "https://files.monday.com/test.pdf"       # get_asset_download_url
    mocks[2].return_value = fake_local_path()                         # download_file
    mocks[3].return_value = "fake-graph-token"                        # get_graph_token
    mocks[4].return_value = "site-id-123"                             # get_sharepoint_site_id
    mocks[5].return_value = "drive-id-456"                            # get_site_drive_id
    mocks[6].return_value = {                                         # upload_file_to_sharepoint
        "webUrl": "https://seedcompany.sharepoint.com/sites/ActiveProjects/TEST%20PROJECT/Language_Profile.pdf"
    }
    mocks[7].return_value = {}                                        # set_folder_metadata


@pytest.mark.parametrize("payload_shape", ["workflow", "workflow_nested", "legacy"])
def test_action_supported_payload_shapes(client, payload_shape):
    with patch("webhook_handler.get_item_column_details") as mock_col, \
         patch("webhook_handler.get_asset_download_url") as mock_url, \
         patch("webhook_handler.download_file") as mock_dl, \
         patch("webhook_handler.get_graph_token") as mock_token, \
         patch("webhook_handler.get_sharepoint_site_id") as mock_site, \
         patch("webhook_handler.get_site_drive_id") as mock_drive, \
         patch("webhook_handler.upload_file_to_sharepoint") as mock_upload, \
         patch("webhook_handler.set_folder_metadata") as mock_meta:

        mock_col.return_value = action_col_details_mock(has_file=True)
        mock_url.return_value = "https://files.monday.com/test.pdf"
        mock_dl.return_value = fake_local_path()
        mock_token.return_value = "fake-token"
        mock_site.return_value = "site-id"
        mock_drive.return_value = "drive-id"
        mock_upload.return_value = {"webUrl": "https://sp.com/file.pdf"}
        mock_meta.return_value = {}

        r = client.post("/monday/action", json=make_action_payload(payload_shape=payload_shape))
        data = r.get_json()

        assert r.status_code == 200
        assert data["success"] is True
        assert data["item_id"] == 12345
        assert data["project_name"] == "TEST PROJECT"
        assert data["sharepoint_url"] == "https://sp.com/file.pdf"


# ── Scenario 1: Language Profile column modified, file present ───────────────

def test_profile_modified_with_file(client):
    with patch("webhook_handler.get_item_column_details") as mock_col, \
         patch("webhook_handler.get_asset_download_url") as mock_url, \
         patch("webhook_handler.download_file") as mock_dl, \
         patch("webhook_handler.get_graph_token") as mock_token, \
         patch("webhook_handler.get_sharepoint_site_id") as mock_site, \
         patch("webhook_handler.get_site_drive_id") as mock_drive, \
         patch("webhook_handler.upload_file_to_sharepoint") as mock_upload, \
         patch("webhook_handler.set_folder_metadata") as mock_meta:

        mock_col.return_value = col_details_mock(has_file=True)
        mock_url.return_value = "https://files.monday.com/test.pdf"
        mock_dl.return_value = fake_local_path()
        mock_token.return_value = "fake-token"
        mock_site.return_value = "site-id"
        mock_drive.return_value = "drive-id"
        mock_upload.return_value = {"webUrl": "https://sp.com/file.pdf"}
        mock_meta.return_value = {}

        r = client.post("/sync-language-profile",
                        json=make_payload(column_title="Language Profile"))
        data = r.get_json()

        assert r.status_code == 200
        assert data["success"] is True
        assert "sharepoint_url" in data
        assert data["folder_path"] == "TEST PROJECT"
        mock_upload.assert_called_once()


# ── Scenario 2: Language Status → "Active", file present ─────────────────────

def test_status_active_with_file(client):
    with patch("webhook_handler.get_item_column_details") as mock_col, \
         patch("webhook_handler.get_asset_download_url") as mock_url, \
         patch("webhook_handler.download_file") as mock_dl, \
         patch("webhook_handler.get_graph_token") as mock_token, \
         patch("webhook_handler.get_sharepoint_site_id") as mock_site, \
         patch("webhook_handler.get_site_drive_id") as mock_drive, \
         patch("webhook_handler.upload_file_to_sharepoint") as mock_upload, \
         patch("webhook_handler.set_folder_metadata") as mock_meta:

        mock_col.return_value = col_details_mock(has_file=True)
        mock_url.return_value = "https://files.monday.com/test.pdf"
        mock_dl.return_value = fake_local_path()
        mock_token.return_value = "fake-token"
        mock_site.return_value = "site-id"
        mock_drive.return_value = "drive-id"
        mock_upload.return_value = {"webUrl": "https://sp.com/file.pdf"}
        mock_meta.return_value = {}

        r = client.post("/sync-language-profile",
                        json=make_payload(column_title="Language Status", status_text="Active"))
        data = r.get_json()

        assert r.status_code == 200
        assert data["success"] is True
        assert "sharepoint_url" in data
        mock_upload.assert_called_once()


# ── Scenario 3: Language Status → "Active", no file ──────────────────────────

@patch("webhook_handler.get_item_column_details")
def test_status_active_no_file(mock_col, client):
    mock_col.return_value = col_details_mock(has_file=False)

    r = client.post("/sync-language-profile",
                    json=make_payload(column_title="Language Status", status_text="Active"))
    data = r.get_json()

    assert r.status_code == 200
    assert data["success"] is False
    assert data["reason"] == "no_file"
    assert data["action"] == "ignore"


# ── Scenario 4: Language Status → non-"Active" ───────────────────────────────

@patch("webhook_handler.get_item_column_details")
def test_status_not_active(mock_col, client):
    mock_col.return_value = col_details_mock(has_file=True)

    r = client.post("/sync-language-profile",
                    json=make_payload(column_title="Language Status", status_text="Inactive"))
    data = r.get_json()

    assert r.status_code == 200
    assert data["success"] is False
    assert data["reason"] == "status_not_active"
    assert data["action"] == "ignore"


# ── Scenario 5: Monday challenge — POST body ──────────────────────────────────

def test_challenge_post(client):
    r = client.post("/sync-language-profile", json={"challenge": "abc123"})
    data = r.get_json()

    assert r.status_code == 200
    assert data["challenge"] == "abc123"


# ── Scenario 6: Monday challenge — GET query param ────────────────────────────

def test_challenge_get(client):
    r = client.get("/sync-language-profile?challenge=abc123")
    data = r.get_json()

    assert r.status_code == 200
    assert data["challenge"] == "abc123"


# ── Scenario 7: Empty payload ─────────────────────────────────────────────────

def test_empty_payload(client):
    r = client.post("/sync-language-profile",
                    data=b"",
                    content_type="application/json")

    assert r.status_code == 400


# ── Scenario 8: Missing pulseId ───────────────────────────────────────────────

def test_missing_pulse_id(client):
    # parse_webhook_payload raises ValueError → caught by outer handler → 500
    payload = {"event": {"pulseName": "TEST PROJECT", "boardId": 123}}
    r = client.post("/sync-language-profile", json=payload)

    assert r.status_code in (400, 500)
    data = r.get_json()
    assert data["success"] is False


# ── Scenario 9: Unrecognised column change (no_trigger) ───────────────────────

@patch("webhook_handler.get_item_column_details")
def test_no_trigger(mock_col, client):
    # File exists but changed column is neither Language Profile nor Language Status
    # and status value is not "Active" — no trigger condition met
    mock_col.return_value = col_details_mock(has_file=True)

    payload = make_payload(column_title="MOU End Date", status_text="2027-12-31")
    r = client.post("/sync-language-profile", json=payload)
    data = r.get_json()

    assert r.status_code == 200
    assert data["success"] is False
    assert data["action"] == "ignore"


# ── Scenario 10: Metadata failure is non-fatal ────────────────────────────────

def test_metadata_failure_nonfatal(client):
    # set_folder_metadata raises — sync should still return success
    with patch("webhook_handler.get_item_column_details") as mock_col, \
         patch("webhook_handler.get_asset_download_url") as mock_url, \
         patch("webhook_handler.download_file") as mock_dl, \
         patch("webhook_handler.get_graph_token") as mock_token, \
         patch("webhook_handler.get_sharepoint_site_id") as mock_site, \
         patch("webhook_handler.get_site_drive_id") as mock_drive, \
         patch("webhook_handler.upload_file_to_sharepoint") as mock_upload, \
         patch("webhook_handler.set_folder_metadata") as mock_meta:

        mock_col.return_value = col_details_mock(has_file=True)
        mock_url.return_value = "https://files.monday.com/test.pdf"
        mock_dl.return_value = fake_local_path()
        mock_token.return_value = "fake-token"
        mock_site.return_value = "site-id"
        mock_drive.return_value = "drive-id"
        mock_upload.return_value = {"webUrl": "https://sp.com/file.pdf"}
        mock_meta.side_effect = Exception("SharePoint metadata patch failed: 400")

        r = client.post("/sync-language-profile",
                        json=make_payload(column_title="Language Status", status_text="Active"))
        data = r.get_json()

        assert r.status_code == 200
        assert data["success"] is True
        assert "sharepoint_url" in data
        mock_upload.assert_called_once()


# ── Scenario 11: Asset URL resolves to None (file column empty asset) ─────────

@patch("webhook_handler.get_item_column_details")
@patch("webhook_handler.get_asset_download_url")
def test_asset_url_none(mock_url, mock_col, client):
    # File column has ID but no downloadable asset URL
    mock_col.return_value = col_details_mock(has_file=True)
    mock_url.return_value = None

    r = client.post("/sync-language-profile",
                    json=make_payload(column_title="Language Status", status_text="Active"))
    data = r.get_json()

    assert r.status_code == 400
    assert data["success"] is False


# ── Scenario 12: Duplicate webhook — idempotent upload ────────────────────────

def test_duplicate_webhook_idempotent(client):
    # Same payload sent twice — both should succeed (SharePoint overwrites)
    with patch("webhook_handler.get_item_column_details") as mock_col, \
         patch("webhook_handler.get_asset_download_url") as mock_url, \
         patch("webhook_handler.download_file") as mock_dl, \
         patch("webhook_handler.get_graph_token") as mock_token, \
         patch("webhook_handler.get_sharepoint_site_id") as mock_site, \
         patch("webhook_handler.get_site_drive_id") as mock_drive, \
         patch("webhook_handler.upload_file_to_sharepoint") as mock_upload, \
         patch("webhook_handler.set_folder_metadata") as mock_meta:

        mock_col.return_value = col_details_mock(has_file=True)
        mock_url.return_value = "https://files.monday.com/test.pdf"
        mock_dl.return_value = fake_local_path()
        mock_token.return_value = "fake-token"
        mock_site.return_value = "site-id"
        mock_drive.return_value = "drive-id"
        mock_upload.return_value = {"webUrl": "https://sp.com/file.pdf"}
        mock_meta.return_value = {}

        payload = make_payload(column_title="Language Status", status_text="Active")

        r1 = client.post("/sync-language-profile", json=payload)
        r2 = client.post("/sync-language-profile", json=payload)

        assert r1.get_json()["success"] is True
        assert r2.get_json()["success"] is True
        assert mock_upload.call_count == 2
