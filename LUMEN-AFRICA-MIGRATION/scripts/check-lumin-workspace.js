/**
 * check-lumin-workspace.js
 * Quick targeted audit of only the LuminAfrica - FG Partner workspace (id: 11389699).
 * Compares against previously known board IDs and reports anything new.
 * Usage: node scripts/check-lumin-workspace.js
 */

import { gql, loadSecret } from "./lib.js";

const LUMEN_WORKSPACE_ID = "11389699";
const PREVIOUSLY_KNOWN_BOARD_IDS = [
  "18254909897",
  "18254909910",
  "8398375595",
  "8398375635",
  "8398375679",
  "8398376038",
];

const secrets = loadSecret();
const token = secrets.MONDAY_API_TOKEN_US;

async function fetchLuminBoards() {
  const boards = [];
  let page = 1;

  while (true) {
    const data = await gql(
      token,
      `query($page: Int!, $workspaceId: ID!) {
        boards(limit: 100, page: $page, workspace_ids: [$workspaceId], order_by: created_at) {
          id
          name
          board_kind
          state
          updated_at
          workspace { id name }
          owners { id name email }
          items_page(limit: 1) { items { id } }
        }
      }`,
      { page, workspaceId: LUMEN_WORKSPACE_ID },
    );

    const batch = data?.boards ?? [];
    if (batch.length === 0) break;

    boards.push(
      ...batch.map((b) => ({
        id: b.id,
        name: b.name,
        board_kind: b.board_kind,
        state: b.state,
        updated_at: b.updated_at,
        workspace: b.workspace,
        owners: b.owners,
        has_items: (b.items_page?.items?.length ?? 0) > 0,
      })),
    );

    if (batch.length < 100) break;
    page += 1;
  }

  return boards;
}

async function main() {
  console.log(`Checking LuminAfrica - FG Partner workspace (id: ${LUMEN_WORKSPACE_ID})...\n`);

  let boards;
  try {
    boards = await fetchLuminBoards();
  } catch (err) {
    console.error("Failed to fetch boards:", err.message);
    process.exit(1);
  }

  console.log(`Total boards found: ${boards.length}\n`);

  const knownSet = new Set(PREVIOUSLY_KNOWN_BOARD_IDS);
  const newBoards = boards.filter((b) => !knownSet.has(b.id));
  const knownBoards = boards.filter((b) => knownSet.has(b.id));
  const missingFromWorkspace = PREVIOUSLY_KNOWN_BOARD_IDS.filter(
    (id) => !boards.find((b) => b.id === id),
  );

  console.log("=== Previously Known Boards (still present) ===");
  for (const b of knownBoards) {
    console.log(`  ✅ ${b.id} | ${b.name} | updated: ${b.updated_at}`);
  }

  if (missingFromWorkspace.length > 0) {
    console.log("\n=== Previously Known Boards (MISSING) ===");
    for (const id of missingFromWorkspace) {
      console.log(`  ⚠️  ${id} — not found in workspace`);
    }
  }

  console.log(`\n=== NEW Boards (added since May 6, 2026) ===`);
  if (newBoards.length === 0) {
    console.log("  (none — no new boards found)");
  } else {
    for (const b of newBoards) {
      console.log(`  🆕 ${b.id} | ${b.name} | updated: ${b.updated_at} | has_items: ${b.has_items}`);

    }
  }

  console.log(`\nSummary: ${knownBoards.length} known, ${newBoards.length} new, ${missingFromWorkspace.length} missing`);

  return newBoards;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
