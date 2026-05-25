import { readFileSync } from "fs";
import { ensureDir, gql, loadSecret, parseArgs, boardIdsFromConfig, writeJson, delay } from "./lib.js";

const OUTPUT_DIR = new URL("../data/", import.meta.url);
const AUDIT_PATH = new URL("../data/sc-workspace-audit.json", import.meta.url);

function boardIdsFromWorkspace(workspaceId) {
  const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
  return (audit.boards ?? [])
    .filter((board) => board.workspace?.id === String(workspaceId))
    .map((board) => String(board.id));
}

async function fetchBoard(token, boardId) {
  const data = await gql(
    token,
    `query($boardId: ID!) {
      boards(ids: [$boardId]) {
        id
        name
        description
        board_kind
        state
        updated_at
        workspace { id name }
        groups { id title position }
        columns {
          id
          title
          type
          settings_str
        }
        items_page(limit: 100) {
          cursor
          items {
            id
            name
            created_at
            updated_at
            group { id title }
            creator_id
            column_values {
              id
              type
              text
              value
            }
            subitems {
              id
              name
              created_at
              updated_at
              column_values {
                id
                type
                text
                value
              }
            }
            updates {
              id
              body
              created_at
              creator { id name email }
            }
          }
        }
      }
    }`,
    { boardId },
  );

  const board = data?.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} not found`);

  const items = [...(board.items_page?.items ?? [])];
  let cursor = board.items_page?.cursor ?? null;

  while (cursor) {
    await delay();
    const pageData = await gql(
      token,
      `query($cursor: String!) {
        next_items_page(limit: 100, cursor: $cursor) {
          cursor
          items {
            id
            name
            created_at
            updated_at
            group { id title }
            creator_id
            column_values {
              id
              type
              text
              value
            }
            subitems {
              id
              name
              created_at
              updated_at
              column_values {
                id
                type
                text
                value
              }
            }
            updates {
              id
              body
              created_at
              creator { id name email }
            }
          }
        }
      }`,
      { cursor },
    );

    const page = pageData?.next_items_page;
    if (!page) break;
    items.push(...(page.items ?? []));
    cursor = page.cursor;
  }

  return {
    exported_at: new Date().toISOString(),
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      board_kind: board.board_kind,
      state: board.state,
      updated_at: board.updated_at,
      workspace: board.workspace ?? null,
    },
    groups: board.groups ?? [],
    columns: board.columns ?? [],
    item_count: items.length,
    items,
  };
}

function collectFiles(boardExport) {
  const files = [];
  for (const item of boardExport.items) {
    for (const value of item.column_values ?? []) {
      if (value.type !== "file" || !value.value) continue;
      const textUrl = typeof value.text === "string" && value.text.startsWith("http") ? value.text : null;
      try {
        const parsed = JSON.parse(value.value);
        const assets = parsed?.files ?? parsed?.assets ?? [];
        for (const asset of assets) {
          files.push({
            board_id: boardExport.board.id,
            item_id: item.id,
            item_name: item.name,
            column_id: value.id,
            asset_id: asset.assetId ?? asset.id ?? null,
            url: asset.public_url ?? asset.url ?? textUrl,
            name: asset.name ?? asset.fileName ?? null,
          });
        }
      } catch {
        // Ignore malformed file JSON but keep export running.
      }
    }
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secret = loadSecret();
  const boardIds = args["workspace-id"]
    ? boardIdsFromWorkspace(args["workspace-id"])
    : boardIdsFromConfig(secret, args["board-id"]);
  if (boardIds.length === 0) throw new Error("No board IDs configured");

  ensureDir(OUTPUT_DIR.pathname);
  for (const boardId of boardIds) {
    const exportData = await fetchBoard(secret.MONDAY_API_TOKEN_US, boardId);
    exportData.files = collectFiles(exportData);
    const outputPath = new URL(`../data/board-${boardId}.json`, import.meta.url);
    writeJson(outputPath.pathname, exportData);
    console.log(`Exported ${exportData.board.name} (${boardId}) with ${exportData.item_count} items`);
    console.log(`Saved to ${outputPath.pathname}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});