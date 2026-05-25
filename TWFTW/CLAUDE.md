# CLAUDE.md

> **Response rules:** See [global CLAUDE.md](/Users/edwinbrooks/Projects/CLAUDE.md) — communication style, voice, and persona applied to every interaction.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js project that pulls SCBTF (Scripture-Based Training Fund) quarterly reports from the TWFTW ERA API and imports them into Monday.com boards in the Dev TranTrak workspace.

## Credentials

`monday-secret.json` (gitignored) must exist at the project root:
```json
{ "MONDAY_API_TOKEN": "your_token_here" }
```

The SCBTF ERA API requires an `AUTH-API-KEY` header. Store it in `monday-secret.json` or a separate `era-secret.json`:
```json
{ "ERA_API_KEY": "your_key_here" }
```

## Monday.com Target Board

**Board ID:** `18242424286` — "SCBTF Reports" (production)
**Board URL:** `https://seed-company-squad.monday.com/boards/18242424286`

**Relevant column IDs:**
| Column ID | Title | Type | Purpose |
|-----------|-------|------|---------|
| `name` | Name | name | Item name, e.g. "Hanila (nlx)" |
| `text_mkwz2wgj` | Report ID | text | e.g. "HAN03895" |
| `text_mkwjbhwm` | Language ISO/EthCode | text | ISO code, e.g. "nlx" |
| `text_mkwmdbe1` | ROD/ROLV | text | ROLV number, e.g. "03895" |
| `long_text_mkx5xyv2` | Testimonial 1 | long_text | First testimonial |
| `long_text_mkx5cv9w` | Testimonial 2 | long_text | Second testimonial |
| `file_mkwyynga` | Excel | file | Uploaded .xlsm file ("FIN" = financial report) |
| `file_mkwyrdrf` | PDF | file | Uploaded .pdf file ("NAR" = narrative report) |
| `link_mkx3hwsc` | PNP Excel Link | link | S3 URL to Excel file |
| `link_mkx3nd0r` | PNP PDF Link | link | S3 URL to PDF file |
| `text_mkwmq1bz` | Data Source | text | Set to "API" |
| `text_mkx1mbte` | Overall Project Goals | text | From API if available |

The existing group is `group_mkwxwgj1`. New quarter groups (e.g. "Q1 2026") should be created via `create_group` mutation before importing.

## ERA API — SCBTF Reports

**Endpoint:** `POST https://era.twftw.net/v1/api/reports/scbtf/`
**Auth header:** `AUTH-API-KEY: <key>`
**Request body:** `{ "year": 2026, "quarter": 1 }`

**Response fields used:**
- `LanguageName` — full name, e.g. "Hanila"
- `LanguageISO` — ISO code, e.g. "nlx"
- `LanguageROLV` — ROLV number, e.g. "03895"
- `Testimonials[0][0]` — first testimonial text
- `Testimonials[0][1]` — second testimonial text
- `Pics[0]` — array of image URLs
- `PNPExcel` — S3 URL for .xlsm file
- `PNPPDF` — S3 URL for .pdf file

Q1 2025 returns 135 records.

## Architecture

**Pipeline flow:**
```
ERA API (POST /v1/api/reports/scbtf/)
  → fetch-reports.js     (fetch JSON for given year/quarter → output/reports-raw.json)
  → transform.js         (normalize records → output/reports-cleaned.json)
  → import-reports.js    (create items + upload files to Monday.com board)
```

**Monday.com API pattern:**
- All calls: `POST https://api.monday.com/v2`
- Headers: `Authorization: <token>`, `Content-Type: application/json`, `API-Version: 2024-01`
- File uploads use `add_file_to_column` mutation with multipart form data (download file from S3, upload to Monday)
- Paginate with `items_page(limit: 100)` + `cursor` / `next_items_page`
- Duplicate detection: match existing items by **ROLV** (`text_mkwmdbe1`) first, fall back to item name — **do not match by ISO** (`text_mkwjbhwm`) alone, as multiple languages can share the same ISO code (e.g. `vaa`, `nst`, `kin`)

**File upload approach:** Monday.com file columns require the `add_file_to_column` mutation with multipart/form-data — you cannot set file columns via JSON column_values in `create_item`. The workflow is:
1. Create the item (text, links, testimonials) via `create_item`
2. Download each file from S3 to a temp path
3. Upload via `add_file_to_column` mutation

## Output Files

All generated files go in `output/` (gitignored):
- `reports-raw.json` — raw API response
- `reports-cleaned.json` — normalized records ready to import
- `import-results.json` — results from live import run
