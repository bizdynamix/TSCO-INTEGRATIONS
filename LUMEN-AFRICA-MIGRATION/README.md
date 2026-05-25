# Lumen Africa Monday.com Migration
## SC US → EU Data Center

**Status:** Pre-migration (awaiting data collection)  
**Timeline:** Week of May 5 → Week of May 19, 2026  
**Migration Type:** Cross-datacenter board + automation sync

---

## Quick Start

### Phase 0: Data Collection (Due May 9)
Mark collects from Lumen Africa + SC IT:
- Source board IDs + names
- Target EU workspace details
- Automation/integration requirements
- API tokens + approvals

### Phase 1: Validation (Week of May 12)
```bash
npm install
node scripts/validate-boards.js
```

### Phase 2: Dry Run (Week of May 12)
```bash
node scripts/export-boards.js --dry-run --board-id <test-board-id>
node scripts/import-boards.js --dry-run --target-workspace <eu-workspace-id>
```

### Phase 3: Full Migration (Week of May 19)
```bash
node scripts/export-boards.js --all
node scripts/import-boards.js --all
```

---

## Folders

| Folder | Purpose |
|---|---|
| `scripts/` | Migration scripts (export, import, validate) |
| `data/` | Exported board data (JSON) |
| `reports/` | Migration reports + logs |

---

## Scripts

| Script | Purpose |
|---|---|
| `validate-boards.js` | Verify API tokens + board IDs before migration |
| `export-boards.js` | Pull boards + items from SC US instance |
| `import-boards.js` | Create boards in EU instance |
| `sync-automations.js` | Recreate Monday automations (if needed) |

---

## Config

Create `.env` in this directory:

```
# SC US Instance
MONDAY_API_TOKEN_US=<token>
MONDAY_BOARD_IDS=<id1>,<id2>,<id3>

# Lumen Africa EU Instance
MONDAY_API_TOKEN_EU=<token>
MONDAY_WORKSPACE_ID_EU=<workspace-id>
MONDAY_TEAM_ID_EU=<team-id>

# Options
PRESERVE_HISTORY=true
PRESERVE_AUTOMATIONS=false
DRY_RUN=true
```

---

## Tracking

- **Board Count:** TBD (awaiting Lumen Africa)
- **Estimated Items:** TBD
- **Attachments:** TBD
- **Automations:** TBD

---

## Next Steps

1. **Mark:** Collect data from Lumen Africa + SC IT (due May 9)
2. **Me:** Build + test scripts (week of May 12)
3. **Dry-run:** Test one board (week of May 12)
4. **Full migration:** Go-live (week of May 19)

---

See `LUMEN-AFRICA-MONDAY-MIGRATION-PLAN.md` in seed-company-docs for full planning docs.
