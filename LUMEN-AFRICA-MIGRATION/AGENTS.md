# Lumen Africa Migration — Agent Instructions

## Project Summary

Migrate 6 boards from Seed Company's **US Monday.com** (`LuminAfrica - FG Partner` workspace) to Lumen Africa's own **EU Monday.com** instance. Cross-datacenter — built-in Monday copier won't work; all migration is via custom Node.js scripts using the Monday GraphQL API.

**Current status (May 2026):** Phases 1–2 complete. All boards migrated to EU. Folder hierarchy mirrored. Manual board placement and automations remain.

---

## Key Files

| File | Purpose |
|------|---------|
| `monday-secret.json` | API tokens + config — **never commit, never log** |
| `reports/MARK-MIGRATION-PLAN.md` | Phased plan; source of truth for migration status |
| `reports/import-plan.json` | Dry-run import plan generated from exported board data |
| `reports/board-summary.json` | Item/column/file counts for all 6 boards |
| `data/board-*.json` | Exported US board data (schema + items + column values) |
| `data/attachments/` | Downloaded binary files, keyed by board ID |
| `scripts/lib.js` | Shared helpers: `gql()`, `loadSecret()`, `parseArgs()`, `delay()` |

## Scripts

| NPM Script | File | What it does |
|------------|------|-------------|
| `npm run export` | `scripts/export-board.js` | Export a board from US to `data/` |
| `npm run import` | `scripts/import-board.js` | Generate dry-run import plan → `reports/import-plan.json` |
| `npm run import:dry` | same | Alias for dry-run |
| `npm run download` | `scripts/download-attachments.js` | Download binary files from US to `data/attachments/` |
| `npm run summary` | `scripts/summarize-boards.js` | Summarize exported boards → `reports/board-summary.json` |
| `npm run audit` | `scripts/audit-sc-workspace.js` | Audit SC workspace structure |
| `npm run audit:automation` | `scripts/audit-automation-surface.js` | Audit automation surface |
| `npm run check-monday` | `scripts/check-monday-connection.js` | **Pre-flight check** — validate US + EU tokens, print MCP guidance |
| `npm run mirror-layout` | `scripts/mirror-workspace-layout.js` | Create EU folder hierarchy matching US structure |
| `npm run mirror-layout:dry` | same | Dry-run — print plan without creating folders |

---

## monday-secret.json Shape

```json
{
  "MONDAY_API_TOKEN_US": "...",
  "MONDAY_BOARD_IDS": ["..."],
  "MONDAY_API_TOKEN_EU": "...",       ← set (EU account: Luminafrica NPC, id: 34084766)
  "MONDAY_WORKSPACE_ID_EU": "5927902"  ← main EU workspace
}
```

---

## Architecture Decisions

- **ES Modules** (`"type": "module"` in package.json) — use `import/export`, not `require`
- **No hardcoded column IDs** — always fetch board schema dynamically and map by ID
- **Cursor-based pagination** — 100 items/page max for Monday API
- **Rate limits** — US: 500ms delay between requests; EU: 450ms+ (see `RATE_LIMIT_DELAY_MS` in `lib.js`)
- **File upload** — must use `add_file_to_column` mutation via multipart/form-data (no global endpoint)

## API Quirks

| Issue | Workaround |
|-------|------------|
| `title` removed from `ColumnValue` | Join by ID from `board { columns { id title } }` |
| `FileValue` inline fragment removed | Parse `value` JSON directly for `asset_id` |
| Cross-DC tokens don't work | US token → `api.monday.com`, EU token → `api.monday.com` (same URL, different auth) |

## Column Import Strategies (from `import-board.js`)

| Column type | Strategy |
|-------------|----------|
| `name` | `builtin` — always exists |
| `file` | `create-column-and-upload-files-later` |
| `subtasks` | `manual-subitems-replay` |
| `board-relation`, `dependency`, `mirror`, `formula` | `manual-rebuild` |
| `people` | `manual-user-mapping` — blocked until user mapping confirmed |
| everything else | `standard-create` |

---

## Current Blockers / Next Steps

Migration is complete. Remaining manual items for Mark:

1. **Board placement** — EU workspace 5927902 has folders but boards are not yet inside them.
   Run `npm run mirror-layout` to see the exact drag-and-drop list, or check `scripts/mirror-workspace-layout.js`.
2. **Delete default groups** — each of the 6 migrated boards has an auto-created default group to remove.
3. **Link Monday Docs** — link "Follow Up Reminder" (5096075389) and "Contract to Clients" (5096075391) to their file columns.
4. **Re-link subitems board** — Event Planning → Subitems of Event Planning (Board Settings → Subitems).
5. **Rebuild automations** — cannot be extracted via API; manual rebuild in EU required.
6. **People columns** — remain empty until SC→EU user mapping is confirmed.

See [reports/MARK-MIGRATION-PLAN.md](reports/MARK-MIGRATION-PLAN.md) for the full phased plan.

---

## MCP Monday Tools

### Setup (one-time per machine)
Two workspace-level MCP servers are configured in `.vscode/mcp.json`:
- **`monday-us`** → Seed Company US account (id: 12597801)
- **`monday-eu`** → Luminafrica NPC EU account (id: 34084766)

If any MCP tool returns `Not authenticated`:
1. Open VS Code Command Palette → **"MCP: List Servers"**
2. Click `monday-us` → enter `MONDAY_API_TOKEN_US` from `monday-secret.json`
3. Click `monday-eu` → enter `MONDAY_API_TOKEN_EU` from `monday-secret.json`
4. Run `npm run check-monday` to confirm both tokens valid

### Pre-flight check
Run **`npm run check-monday`** at the start of any Monday-related session.
This validates both tokens and prints the MCP setup reminder if needed.

### When to use MCP tools vs scripts

| Use MCP (`mcp_com_monday_mo_*` or `monday-us`/`monday-eu`) | Use direct scripts (`node scripts/*`) |
|---|---|
| Ad-hoc reads: boards, items, workspaces | Bulk import / migrate / batch-create |
| One-off lookups and inline decisions | EU-specific write operations |
| Creating single items/boards/groups interactively | Pagination over hundreds of items |
| — | File uploads (multipart, not in MCP) |

> The global `mcp_com_monday_mo_*` tools connect to whichever account the stored VS Code secret was set for. Workspace `monday-us` / `monday-eu` servers are explicit per-account.
