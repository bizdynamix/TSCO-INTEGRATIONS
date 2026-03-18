# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Overview

Monorepo of two independent ETL integrations for TSCO (The Seed Company):

| Directory | Stack | Pipeline |
|-----------|-------|---------|
| `TWFTW/` | Node.js (ES modules) | ERA API → Monday.com |
| `MONDAY-SHAREPOINT/` | Python 3.11+ | Monday.com → SharePoint |

Neither project has a build system, linter, or test suite. Scripts are standalone data pipelines run manually.

---

## TWFTW

Pulls quarterly SCBTF reports from the TWFTW ERA API and uploads Excel/PDF files to a Monday.com board.

See `TWFTW/CLAUDE.md` for full board schema, column IDs, and ERA API spec.

### Commands

```bash
cd TWFTW
node fetch-reports.js 2026 1      # Fetch Q1 2026 → output/reports-raw.json
node import-reports.js --dry-run  # Preview without writing
node import-reports.js            # Execute live import
```

Or via npm:
```bash
npm run fetch        # node fetch-reports.js
npm run dry-run      # node import-reports.js --dry-run
npm run import       # node import-reports.js
```

### Credentials

`TWFTW/monday-secret.json` (gitignored):
```json
{ "MONDAY_API_TOKEN": "...", "ERA_API_KEY": "..." }
```

### Architecture

Two-stage pipeline with a JSON handoff file:
1. `fetch-reports.js` — POST to ERA API → saves `output/reports-raw.json`
2. `import-reports.js` — reads raw JSON, matches/creates Monday items by `LanguageISO`, downloads S3 files, uploads to Monday file columns

**Key constraints:**
- Monday.com file columns require the `add_file_to_column` mutation with multipart/form-data — you cannot set them via `column_values` in `create_item`. Always: create item first, then upload files separately.
- Duplicate detection: build an `isoMap` from existing board items before processing; match on `text_mkwjbhwm` (Language ISO column).
- Rate limiting: 500ms delay between Monday API calls.

---

## MONDAY-SHAREPOINT

Syncs Language Profile documents from a Monday.com board to SharePoint Active Projects.

### Commands

```bash
cd MONDAY-SHAREPOINT
pip install -r requirements.txt

python sync_missing_profiles.py                        # Full sync (operational)
python monday_to_sharepoint_drytest_onefile.py         # Download one file (dry run)
python monday_to_sharepoint_drytest_onefile.py --upload  # Upload one file to test folder
python monday_to_sharepoint_drytest_onefile.py --upload --force  # Force re-download + upload
```

### Credentials

`MONDAY-SHAREPOINT/.env` (gitignored) — copy from `.env.example`:
```
MONDAY_API_TOKEN=...
TENANT_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
```

Azure AD app requires `Sites.ReadWrite.All` application permission with admin consent.

### Architecture

**Source:** Monday.com board `8445103301` — items filtered to ACTIVE status with a file in the "Language Profile" column.

**Destination:** `seedcompany.sharepoint.com/sites/ActiveProjects/Active Projects/{PROJECT_NAME}/`

**Core module:** `monday_to_sharepoint_drytest_onefile.py` acts as both a test harness and a shared utility library imported by `bulk_migrate_all.py` and `sync_missing_profiles.py`. Key exported functions:

- `Config` — loads env vars
- `monday_api_request()` — GraphQL wrapper with `API-Version: 2024-01` header
- `resolve_column_ids()` — looks up column IDs by title (avoids hardcoding IDs that can change)
- `get_board_items_with_files()` — cursor-based paginated fetch
- `get_graph_access_token()` — OAuth2 client credentials flow
- `ensure_folder_exists()` — recursive SharePoint folder creation (handles 404 → create)
- `file_exists_in_sharepoint()` — idempotency check before upload
- `set_folder_metadata()` — sets `MOUenddate0` field on SharePoint folder

**Auth flow:**
1. `POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token`
2. Use bearer token with `https://graph.microsoft.com/v1.0`

**Monday.com pagination pattern:**
```graphql
boards(ids: [$boardId]) { items_page(limit: 100) { cursor items { ... } } }
# then follow with:
next_items_page(limit: 100, cursor: $cursor) { cursor items { ... } }
```

**Idempotency:** Always check `file_exists_in_sharepoint()` before uploading. Operations are safe to re-run.

### Audit Trail

Reports and migration logs live in `MONDAY-SHAREPOINT/reports/`. The bulk migration (Jan 2026) processed 427 projects. Diagnostic/repair scripts (`audit_*.py`, `fix_*.py`, `compare_*.py`) are one-off utilities from the migration phase.
