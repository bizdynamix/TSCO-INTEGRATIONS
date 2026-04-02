# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js data migration project for CABTAL (an organization). It reads donor/gift data from `DCSE_CRM_RM_DATABASE.xlsx` and migrates it into Monday.com boards via the Monday.com GraphQL API.

## Commands

```bash
# Explore Monday.com board structure
node explore-boards.js              # board structure only
node explore-boards.js --items      # include first 20 items per board
node explore-boards.js --all-items  # include all items (paginated)

# Explore the source Excel file
npm run explore:xlsx

# Transform/clean data from Excel into output/*.json
npm run transform                   # runs transform-people.js and transform-gifts.js

# Review unmatched/flagged records
npm run review                      # console output
npm run review:csv                  # writes output/review-report.csv

# Dry-run import (no writes to Monday.com)
npm run import:dry-run

# Live import to Monday.com
npm run import:people
npm run import:gifts
```

## Architecture

**Pipeline flow:**
```
DCSE_CRM_RM_DATABASE.xlsx
  → explore-xlsx.js       (inspect sheet names, column headers, sample rows)
  → transform-people.js   (clean + normalize people records → output/people-cleaned.json, output/people-flagged.json)
  → transform-gifts.js    (clean + normalize gift records  → output/gifts-cleaned.json,  output/gifts-flagged.json)
  → review-unmatched.js   (report on flagged/unmatched records → output/review-report.csv)
  → import-people.js      (POST to Monday.com boards 18400425732 / 18400425739)
  → import-gifts.js       (POST to Monday.com boards 18400426079)
```

**Monday.com boards (workspace 12962999):**
- `18400425732` — Future CABTAL RM People (Donors) — primary people board
- `18400425739` — Subitems of Future CABTAL RM People
- `18400425898` — Future of CABTAL RM Organizations
- `18400425905` — Subitems of Future CABTAL RM Orgs
- `18400426079` — Future of CABTAL RM GIFTS

**API helper pattern** (used in both explore-boards.js and study-workflow.js):
- All Monday.com calls go to `https://api.monday.com/v2` via POST with `Authorization` header
- Use `API-Version: 2024-01` header
- Paginate with `items_page(limit: 100)` + `cursor` / `next_items_page`

## Credentials

`monday-secret.json` (gitignored) must exist at the project root with:
```json
{ "MONDAY_API_TOKEN": "your_token_here" }
```

Scripts read this file at startup. `study-workflow.js` reads from `tmp/monday-secret.json` instead.

## Output Files

All generated files go in `output/` (gitignored):
- `people-cleaned.json` / `gifts-cleaned.json` — records ready to import
- `people-flagged.json` / `gifts-flagged.json` — records needing manual review
- `import-people-results.json` / `import-gifts-results.json` — results from live import runs
- `review-report.csv` — human-readable flagged record report
