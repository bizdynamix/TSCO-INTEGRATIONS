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

## Standalone Projects

The following projects have been extracted to their own repositories to improve maintainability:

### CABTAL (CRM Migration)
- **Repo:** [bizdynamix/CABTAL](https://github.com/bizdynamix/CABTAL)
- **Purpose:** DCSE donor data migration (Excel → Monday.com)

### LUMEN-AFRICA-MIGRATION
- **Repo:** [bizdynamix/LUMEN-AFRICA-MIGRATION](https://github.com/bizdynamix/LUMEN-AFRICA-MIGRATION)
- **Purpose:** Lumen Africa workspace data migration automation

### MONDAY-SHAREPOINT Integration
- **Repo:** [bizdynamix/monday-sharepoint](https://github.com/bizdynamix/monday-sharepoint)
- **Purpose:** Monday.com ↔ SharePoint sync automation

---

## Credentials

Integrations require credential files that are **not committed to the repository**:

| File | Location | Contains |
|------|----------|---------|
| `monday-secret.json` | `TWFTW/` | `MONDAY_API_TOKEN`, `ERA_API_KEY` |
