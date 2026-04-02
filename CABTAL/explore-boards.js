/**
 * CABTAL Board Explorer
 * Inspects the structure and sample data of all Kabtol/CABTAL-related
 * Monday.com boards so we can plan the cleaning + import scripts.
 *
 * Usage:
 *   node explore-boards.js              — inspect board structure only
 *   node explore-boards.js --items      — also dump sample items (first 20)
 *   node explore-boards.js --all-items  — dump ALL items (paginated)
 */

const fs = require("fs");
const path = require("path");

const secretPath = path.join(__dirname, "monday-secret.json");
const T = JSON.parse(fs.readFileSync(secretPath, "utf8")).MONDAY_API_TOKEN;

const BOARD_IDS = [
  18400425732, // Future CABTAL RM People (Donors)       ← primary people board
  18400425739, // Subitems of Future CABTAL RM People    ← people subitems
  18400425898, // Future of CABTAL RM Organizations      ← orgs board
  18400425905, // Subitems of Future CABTAL RM Orgs      ← org subitems
  18400426079, // Future of CABTAL RM GIFTS              ← gifts/finance board
  // Legacy boards (for reference / data migration)
  // 18231902551 — CABTAL RM People (Donors)  [old]
  // 18231902687 — Subitems of CABTAL RM People (Donors) [old]
];

// Workspace to search for all CABTAL-related boards
const CABTAL_WORKSPACE_ID = 12962999;

const SHOW_ITEMS = process.argv.includes("--items") || process.argv.includes("--all-items");
const ALL_ITEMS  = process.argv.includes("--all-items");

// ── API helper ────────────────────────────────────────────────────────────────
async function gql(query, vars = {}) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: T,
      "Content-Type": "application/json",
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables: vars }),
  });
  const data = await res.json();
  if (data.errors) {
    console.error("API errors:", JSON.stringify(data.errors, null, 2));
  }
  return data.data;
}

// ── Paginated item fetcher ────────────────────────────────────────────────────
async function fetchAllItems(boardId) {
  const items = [];
  let cursor = null;

  do {
    const query = cursor
      ? `query($cursor: String!) {
           next_items_page(limit: 100, cursor: $cursor) {
             cursor
             items { id name group { id title } column_values { id text value } }
           }
         }`
      : `query($boardId: ID!) {
           boards(ids: [$boardId]) {
             items_page(limit: 100) {
               cursor
               items { id name group { id title } column_values { id text value } }
             }
           }
         }`;

    const vars = cursor ? { cursor } : { boardId: String(boardId) };
    const data = await gql(query, vars);

    const page = cursor
      ? data?.next_items_page
      : data?.boards?.[0]?.items_page;

    if (!page) break;
    items.push(...(page.items || []));
    cursor = ALL_ITEMS ? page.cursor : null;
  } while (cursor);

  return items;
}

// ── Board inspector ───────────────────────────────────────────────────────────
async function inspectBoard(boardId) {
  const data = await gql(
    `query($boardId: ID!) {
       boards(ids: [$boardId]) {
         id name description board_kind
         workspace { id name }
         columns { id title type settings_str }
         groups   { id title color }
       }
     }`,
    { boardId: String(boardId) }
  );

  const board = data?.boards?.[0];
  if (!board) {
    console.log(`\n⚠️  Board ${boardId} not found or not accessible.\n`);
    return null;
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`BOARD: ${board.name}  (id: ${board.id})`);
  if (board.description) console.log(`DESC:  ${board.description}`);
  console.log(`KIND:  ${board.board_kind}  |  WORKSPACE: ${board.workspace?.name} (${board.workspace?.id})`);

  console.log(`\n── Columns (${board.columns.length}) ${"─".repeat(50)}`);
  board.columns.forEach((c) => {
    const settings = c.settings_str && c.settings_str !== "{}"
      ? `\n       settings: ${c.settings_str.substring(0, 300)}`
      : "";
    console.log(`  [${c.id.padEnd(20)}] ${c.title.padEnd(30)} type: ${c.type}${settings}`);
  });

  console.log(`\n── Groups (${board.groups.length}) ${"─".repeat(51)}`);
  board.groups.forEach((g) =>
    console.log(`  [${g.id.padEnd(20)}] ${g.title}`)
  );

  if (SHOW_ITEMS) {
    console.log(`\n── Items ${"─".repeat(60)}`);
    const items = await fetchAllItems(boardId);
    console.log(`  Total: ${items.length}`);
    const sample = ALL_ITEMS ? items : items.slice(0, 20);
    sample.forEach((item) => {
      const vals = item.column_values
        .filter((c) => c.text && c.text !== "null" && c.text !== "")
        .map((c) => `${c.id}="${c.text}"`)
        .join(" | ");
      console.log(`  [${item.id}] "${item.name}"  group="${item.group?.title}"  ${vals}`);
    });
    if (!ALL_ITEMS && items.length > 20) {
      console.log(`  … (${items.length - 20} more — run with --all-items to see all)`);
    }
  }

  return board;
}

// ── Column settings decoder ───────────────────────────────────────────────────
function decodeColumnSettings(boardsData) {
  console.log(`\n\n${"═".repeat(72)}`);
  console.log("COLUMN SETTINGS SUMMARY (for mapping reference)");
  console.log(`${"═".repeat(72)}`);

  boardsData.forEach(({ name, columns }) => {
    if (!columns) return;
    console.log(`\n── ${name} ─────`);
    columns
      .filter((c) => c.settings_str && c.settings_str !== "{}")
      .forEach((c) => {
        try {
          const s = JSON.parse(c.settings_str);
          // For status/dropdown columns, print the label options
          const labels =
            s.labels ||
            s.labels_positions_v2 ||
            (s.listValues && Object.values(s.listValues)) ||
            null;
          if (labels) {
            console.log(`  [${c.id}] ${c.title} (${c.type}):`);
            if (Array.isArray(labels)) {
              labels.forEach((l) =>
                console.log(`    • ${l.name || l.value || JSON.stringify(l)}`)
              );
            } else {
              Object.entries(labels).forEach(([k, v]) =>
                console.log(`    [${k}] ${v?.name || v}`)
              );
            }
          }
        } catch (_) {
          // ignore parse errors
        }
      });
  });
}

// ── Workspace board discovery ─────────────────────────────────────────────────
async function discoverWorkspaceBoards(workspaceId) {
  const data = await gql(
    `query($wsId: [ID!]) {
       boards(workspace_ids: $wsId, limit: 50) {
         id name board_kind
         workspace { id name }
       }
     }`,
    { wsId: [String(workspaceId)] }
  );
  const boards = data?.boards;
  if (!boards || boards.length === 0) {
    console.log(`\n⚠️  No boards found in workspace ${workspaceId}.\n`);
    return;
  }
  const wsName = boards[0]?.workspace?.name || workspaceId;
  console.log(`\n${"═".repeat(72)}`);
  console.log(`WORKSPACE: ${wsName}  (id: ${workspaceId})`);
  console.log(`── All Boards (${boards.length}) ${"─".repeat(47)}`);
  boards.forEach((b) =>
    console.log(`  [${b.id}]  ${b.name}  (${b.board_kind})`)
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log("CABTAL Monday.com Board Explorer");
  console.log(`Token: ${T ? T.substring(0, 8) + "…" : "NOT FOUND"}`);
  console.log(`Boards to inspect: ${BOARD_IDS.join(", ")}`);
  console.log(`Show items: ${SHOW_ITEMS} | All items: ${ALL_ITEMS}`);

  // First: list all boards in the CABTAL workspace
  await discoverWorkspaceBoards(CABTAL_WORKSPACE_ID);

  const boards = [];
  for (const id of BOARD_IDS) {
    const board = await inspectBoard(id);
    if (board) boards.push(board);
  }

  if (boards.length > 0) {
    decodeColumnSettings(boards);
  }

  console.log("\n\nDone.\n");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
