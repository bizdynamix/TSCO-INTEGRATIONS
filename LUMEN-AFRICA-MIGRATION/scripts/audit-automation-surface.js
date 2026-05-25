import { readFileSync, readdirSync } from "fs";
import { gql, loadSecret, writeJson } from "./lib.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const OUTPUT_PATH = new URL("../reports/automation-surface-audit.json", import.meta.url);

function exportedBoardFiles() {
  return readdirSync(DATA_DIR.pathname)
    .filter((name) => /^board-\d+\.json$/.test(name))
    .map((name) => new URL(`../data/${name}`, import.meta.url));
}

function loadBoardExport(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, "utf8"));
}

function summarizeColumnTypes(columns) {
  const counts = {};
  for (const column of columns ?? []) {
    counts[column.type] = (counts[column.type] ?? 0) + 1;
  }
  return counts;
}

function workflowSignals(boardExport) {
  const columnTypeCounts = summarizeColumnTypes(boardExport.columns ?? []);
  const fileEntries = boardExport.files ?? [];
  const mondayDocs = fileEntries.filter((entry) => !entry.asset_id && /\/docs\//.test(entry.url ?? ""));
  const downloadableFiles = fileEntries.filter((entry) => entry.asset_id);
  const linkColumns = (boardExport.columns ?? []).filter((column) => column.type === "link");
  const emailColumns = (boardExport.columns ?? []).filter((column) => column.type === "email");
  const relationColumns = (boardExport.columns ?? []).filter((column) =>
    ["board-relation", "mirror", "dependency", "formula", "connect_boards"].includes(column.type),
  );

  return {
    column_type_counts: columnTypeCounts,
    link_columns: linkColumns.map((column) => ({ id: column.id, title: column.title })),
    email_columns: emailColumns.map((column) => ({ id: column.id, title: column.title })),
    relation_columns: relationColumns.map((column) => ({ id: column.id, title: column.title, type: column.type })),
    downloadable_file_count: downloadableFiles.length,
    monday_doc_count: mondayDocs.length,
    monday_docs: mondayDocs.map((entry) => ({ item_id: entry.item_id, item_name: entry.item_name, url: entry.url })),
  };
}

async function fetchBoardAccess(token, boardId) {
  const data = await gql(
    token,
    `query($id: ID!) {
      boards(ids: [$id]) {
        id
        name
        permissions
        subscribers { id name email }
        team_subscribers { id name }
        owners { id name email }
      }
    }`,
    { id: boardId },
  );

  return data?.boards?.[0] ?? null;
}

async function main() {
  const { MONDAY_API_TOKEN_US } = loadSecret();
  const files = exportedBoardFiles();
  const boards = [];

  for (const file of files) {
    const boardExport = loadBoardExport(file);
    const access = await fetchBoardAccess(MONDAY_API_TOKEN_US, boardExport.board.id);
    boards.push({
      board: boardExport.board,
      access: access
        ? {
            permissions: access.permissions,
            owners: access.owners ?? [],
            subscribers: access.subscribers ?? [],
            team_subscribers: access.team_subscribers ?? [],
          }
        : null,
      workflow_signals: workflowSignals(boardExport),
      api_limitations: {
        automations_exposed: false,
        integrations_exposed: false,
        webhooks_exposed: false,
        note:
          "Monday GraphQL v2024-01 does not expose board automations, integrations, or webhooks on Board in this workspace. Recipe rebuild will require manual review in the Monday UI.",
      },
      recommended_manual_review: [
        "Automation recipes in board settings",
        "Connected apps / integrations",
        "Webhook destinations",
        "Monday Docs linked in file columns",
      ],
    });
  }

  writeJson(OUTPUT_PATH.pathname, {
    audited_at: new Date().toISOString(),
    scope: "LuminAfrica workspace export",
    board_count: boards.length,
    api_capability_summary: {
      supported: ["owners", "subscribers", "team_subscribers", "permissions", "column schema", "item updates", "file asset IDs"],
      unsupported: ["automations", "integrations", "webhooks"],
    },
    boards,
  });

  console.log(`Saved automation surface audit to ${OUTPUT_PATH.pathname}`);
  for (const entry of boards) {
    console.log(
      `${entry.board.id} | ${entry.board.name} | permissions=${entry.access?.permissions ?? "unknown"} | docs=${entry.workflow_signals.monday_doc_count} | files=${entry.workflow_signals.downloadable_file_count}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});