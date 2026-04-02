# TSCO Integrations

Automated data integrations for TSCO (The Seed Company) systems.

---

## TWFTW/

**ERA API → Monday.com**

Pulls quarterly SCBTF reports from the TWFTW ERA API and uploads Excel and PDF files into the Dev TranTrak Monday.com board.

- Language: Node.js
- Source: `https://era.twftw.net/v1/api/reports/scbtf/`
- Destination: Monday.com board `18291610070` (Dev TranTrak workspace)
- Columns populated: `FIN Q{Q} {YEAR}` (Excel), `NAR Q{Q} {YEAR}` (PDF)

```bash
cd TWFTW
node fetch-reports.js 2026 1     # fetch Q1 2026 from ERA API
node import-reports.js --dry-run  # preview
node import-reports.js            # run
```

---

## CABTAL/

**DCSE CRM Data Integration**

Imports organizations, people, and gift data from Excel into the Monday.com DCSE CRM board.

- Language: Node.js
- Source: `DCSE_CRM_RM_DATABASE.xlsx`
- Destination: Monday.com DCSE CRM board

---

## Monday-SharePoint Migration

> **Note:** The Monday-SharePoint migration project lives in its own standalone repository at `../MONDAY-SHAREPOINT/`. It was removed from this repo to avoid duplication.

---

## Credentials

Integrations require credential files that are **not committed to the repository**:

| File | Location | Contains |
|------|----------|---------|
| `monday-secret.json` | `TWFTW/` | `MONDAY_API_TOKEN`, `ERA_API_KEY` |
