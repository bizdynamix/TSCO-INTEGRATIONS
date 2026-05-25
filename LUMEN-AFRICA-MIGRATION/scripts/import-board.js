import { readFileSync, readdirSync } from "fs";
import { ensureDir, loadSecret, parseArgs, writeJson } from "./lib.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const REPORTS_DIR = new URL("../reports/", import.meta.url);
const OUTPUT_PATH = new URL("../reports/import-plan.json", import.meta.url);

const COLUMN_RULES = {
  name: "builtin",
  file: "create-column-and-upload-files-later",
  subtasks: "manual-subitems-replay",
  "board-relation": "manual-rebuild",
  dependency: "manual-rebuild",
  mirror: "manual-rebuild",
  formula: "manual-rebuild",
  people: "manual-user-mapping",
};

function exportedBoardFiles() {
  return readdirSync(DATA_DIR.pathname)
    .filter((name) => /^board-\d+\.json$/.test(name))
    .map((name) => new URL(`../data/${name}`, import.meta.url));
}

function loadJson(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, "utf8"));
}

function boardFilter(boardId) {
  return (fileUrl) => {
    if (!boardId) return true;
    return fileUrl.pathname.endsWith(`board-${boardId}.json`);
  };
}

function classifyColumn(column) {
  return {
    id: column.id,
    title: column.title,
    type: column.type,
    import_strategy: COLUMN_RULES[column.type] ?? "standard-create",
  };
}

function summarizeItems(items) {
  return {
    item_count: items.length,
    subitem_count: items.reduce((total, item) => total + (item.subitems?.length ?? 0), 0),
    update_count: items.reduce((total, item) => total + (item.updates?.length ?? 0), 0),
  };
}

function summarizeFiles(files) {
  const binaryFiles = files.filter((file) => file.asset_id).length;
  const mondayDocs = files.filter((file) => !file.asset_id).length;
  return {
    total_file_references: files.length,
    binary_file_count: binaryFiles,
    monday_doc_count: mondayDocs,
  };
}

function buildBoardPlan(boardExport, targetWorkspaceId) {
  const columns = (boardExport.columns ?? []).map(classifyColumn);
  const manualColumns = columns.filter((column) => column.import_strategy !== "standard-create" && column.import_strategy !== "builtin");
  const fileSummary = summarizeFiles(boardExport.files ?? []);

  return {
    source_board_id: boardExport.board.id,
    source_board_name: boardExport.board.name,
    source_workspace: boardExport.board.workspace?.name ?? null,
    target_workspace_id: targetWorkspaceId || null,
    board_kind: boardExport.board.board_kind,
    create_board: {
      board_name: boardExport.board.name,
      board_kind: boardExport.board.board_kind,
      description: boardExport.board.description,
    },
    groups_to_create: (boardExport.groups ?? []).map((group) => ({
      id: group.id,
      title: group.title,
    })),
    columns_to_create: columns,
    item_summary: summarizeItems(boardExport.items ?? []),
    file_summary: fileSummary,
    manual_follow_up: [
      ...new Set([
        ...(manualColumns.length > 0 ? ["Review manual column strategies before live import"] : []),
        ...(fileSummary.binary_file_count > 0 ? ["Replay binary file uploads after items are created"] : []),
        ...(fileSummary.monday_doc_count > 0 ? ["Recreate Monday Docs manually from preserved doc URLs"] : []),
        ...((boardExport.items ?? []).some((item) => (item.subitems?.length ?? 0) > 0)
          ? ["Recreate subitems after parent items are imported"]
          : []),
        ...((boardExport.items ?? []).some((item) => (item.updates?.length ?? 0) > 0)
          ? ["Replay item updates/comments if history must be preserved"]
          : []),
        ...((boardExport.columns ?? []).some((column) => column.type === "people")
          ? ["Map SC users to Lumin EU users before assigning people columns"]
          : []),
      ]),
    ],
  };
}

function buildImportPlan(boardExports, config, dryRun) {
  const boards = boardExports.map((boardExport) => buildBoardPlan(boardExport, config.MONDAY_WORKSPACE_ID_EU));
  return {
    planned_at: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "ready-for-live-import",
    eu_ready: Boolean(config.MONDAY_API_TOKEN_EU && config.MONDAY_WORKSPACE_ID_EU),
    target_workspace_id: config.MONDAY_WORKSPACE_ID_EU || null,
    board_count: boards.length,
    boards,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadSecret();
  const dryRun = Boolean(args["dry-run"]) || !config.MONDAY_API_TOKEN_EU || !config.MONDAY_WORKSPACE_ID_EU;

  const boardExports = exportedBoardFiles()
    .filter(boardFilter(args["board-id"]))
    .map(loadJson);

  if (boardExports.length === 0) {
    throw new Error("No exported board JSON files found for import planning");
  }

  ensureDir(REPORTS_DIR.pathname);
  const plan = buildImportPlan(boardExports, config, dryRun);
  writeJson(OUTPUT_PATH.pathname, plan);

  console.log(`Saved import plan to ${OUTPUT_PATH.pathname}`);
  for (const board of plan.boards) {
    console.log(
      `${board.source_board_id} | ${board.source_board_name} | groups=${board.groups_to_create.length} | columns=${board.columns_to_create.length} | items=${board.item_summary.item_count} | manual=${board.manual_follow_up.length}`,
    );
  }

  if (dryRun) {
    console.log("\nDry-run mode: no EU writes attempted. Fill MONDAY_API_TOKEN_EU and MONDAY_WORKSPACE_ID_EU to enable live import work.");
  }
}

main();