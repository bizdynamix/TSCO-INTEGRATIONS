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

## MONDAY-SHAREPOINT/

**Monday.com → SharePoint**

Migrates Language Profile documents from the Monday.com Partner Projects board to the SharePoint Active Projects site. Completed as a bulk migration in Jan 2026; scripts remain for re-runs and future syncs.

- Language: Python 3.11+
- Source: Monday.com board `8445103301` (Multiplication Language Space)
- Destination: `seedcompany.sharepoint.com/sites/ActiveProjects`
- Key scripts: `sync_missing_profiles.py` (full sync), `bulk_migrate_all.py` (original bulk run)

```bash
cd MONDAY-SHAREPOINT
pip install -r requirements.txt
python sync_missing_profiles.py
```

Reports and audit files are in `MONDAY-SHAREPOINT/reports/`.

---

## Credentials

Both integrations require credential files that are **not committed to the repository**:

| File | Location | Contains |
|------|----------|---------|
| `monday-secret.json` | `TWFTW/` | `MONDAY_API_TOKEN`, `ERA_API_KEY` |
| `.env` | `MONDAY-SHAREPOINT/` | `MONDAY_API_TOKEN`, Azure AD credentials |
