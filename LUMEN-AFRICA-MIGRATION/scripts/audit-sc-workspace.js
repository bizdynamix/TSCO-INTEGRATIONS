import { ensureDir, gql, loadSecret, writeJson } from "./lib.js";

const OUTPUT_DIR = new URL("../data/", import.meta.url);
const OUTPUT_PATH = new URL("../data/sc-workspace-audit.json", import.meta.url);

async function fetchBoards(token) {
  const boards = [];
  let page = 1;

  while (true) {
    const data = await gql(
      token,
      `query($page: Int!) {
        boards(limit: 100, page: $page) {
          id
          name
          board_kind
          updated_at
          state
          workspace { id name }
          owners { id name email }
          items_page(limit: 1) { items { id } }
        }
      }`,
      { page },
    );

    const batch = data?.boards ?? [];
    if (batch.length === 0) break;

    boards.push(
      ...batch.map((board) => ({
        id: board.id,
        name: board.name,
        board_kind: board.board_kind,
        state: board.state,
        updated_at: board.updated_at,
        workspace: board.workspace ?? null,
        owners: board.owners ?? [],
        has_items_sample: (board.items_page?.items?.length ?? 0) > 0,
        flagged:
          /lumen|lumin|africa/i.test(board.name) ||
          /lumen|lumin|africa/i.test(board.workspace?.name ?? ""),
      })),
    );

    if (batch.length < 100) break;
    page += 1;
  }

  return boards;
}

function printSummary(boards) {
  console.log(`Found ${boards.length} boards in SC workspace.\n`);
  for (const board of boards) {
    const marker = board.flagged ? "***" : "   ";
    const workspaceName = board.workspace?.name ?? "No workspace";
    console.log(`${marker} ${board.id} | ${board.name} | ${workspaceName}`);
  }
}

async function main() {
  const { MONDAY_API_TOKEN_US } = loadSecret();
  if (!MONDAY_API_TOKEN_US) throw new Error("MONDAY_API_TOKEN_US is missing");

  ensureDir(OUTPUT_DIR.pathname);
  const boards = await fetchBoards(MONDAY_API_TOKEN_US);
  writeJson(OUTPUT_PATH.pathname, {
    audited_at: new Date().toISOString(),
    count: boards.length,
    boards,
  });
  printSummary(boards);
  console.log(`\nSaved audit to ${OUTPUT_PATH.pathname}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});