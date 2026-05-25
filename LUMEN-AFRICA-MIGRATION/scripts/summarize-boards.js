import { readFileSync, readdirSync } from "fs";
import { writeJson } from "./lib.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const MANIFEST_PATH = new URL("../data/download-manifest.json", import.meta.url);
const OUTPUT_PATH = new URL("../reports/board-summary.json", import.meta.url);

function exportedBoardFiles() {
  return readdirSync(DATA_DIR.pathname)
    .filter((name) => /^board-\d+\.json$/.test(name))
    .map((name) => new URL(`../data/${name}`, import.meta.url));
}

function loadJson(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, "utf8"));
}

function countSubitems(items) {
  return (items ?? []).reduce((total, item) => total + (item.subitems?.length ?? 0), 0);
}

function countUpdates(items) {
  return (items ?? []).reduce((total, item) => total + (item.updates?.length ?? 0), 0);
}

function manifestByBoard(manifest) {
  return manifest.files.reduce((acc, entry) => {
    const key = String(entry.board_id);
    acc[key] ??= [];
    acc[key].push(entry);
    return acc;
  }, {});
}

function summarizeBoard(boardExport, manifestEntries) {
  const downloaded = manifestEntries.filter((entry) => entry.status === "downloaded").length;
  const skippedDocs = manifestEntries.filter((entry) => entry.status === "skipped" && /Unsupported file type/.test(entry.reason ?? "")).length;

  return {
    board_id: boardExport.board.id,
    board_name: boardExport.board.name,
    workspace: boardExport.board.workspace?.name ?? null,
    item_count: boardExport.item_count,
    subitem_count: countSubitems(boardExport.items),
    update_count: countUpdates(boardExport.items),
    group_count: boardExport.groups?.length ?? 0,
    column_count: boardExport.columns?.length ?? 0,
    file_reference_count: boardExport.files?.length ?? 0,
    downloaded_file_count: downloaded,
    skipped_doc_count: skippedDocs,
    column_types: Array.from(new Set((boardExport.columns ?? []).map((column) => column.type))).sort(),
  };
}

function main() {
  const boardFiles = exportedBoardFiles();
  const manifest = loadJson(MANIFEST_PATH);
  const byBoard = manifestByBoard(manifest);

  const boards = boardFiles.map((file) => {
    const boardExport = loadJson(file);
    return summarizeBoard(boardExport, byBoard[String(boardExport.board.id)] ?? []);
  });

  const totals = boards.reduce(
    (acc, board) => {
      acc.boards += 1;
      acc.items += board.item_count;
      acc.subitems += board.subitem_count;
      acc.updates += board.update_count;
      acc.file_references += board.file_reference_count;
      acc.downloaded_files += board.downloaded_file_count;
      acc.skipped_docs += board.skipped_doc_count;
      return acc;
    },
    {
      boards: 0,
      items: 0,
      subitems: 0,
      updates: 0,
      file_references: 0,
      downloaded_files: 0,
      skipped_docs: 0,
    },
  );

  writeJson(OUTPUT_PATH.pathname, {
    summarized_at: new Date().toISOString(),
    totals,
    boards,
  });

  console.log(`Saved board summary to ${OUTPUT_PATH.pathname}`);
  for (const board of boards) {
    console.log(
      `${board.board_id} | ${board.board_name} | items=${board.item_count} | subitems=${board.subitem_count} | files=${board.downloaded_file_count}/${board.file_reference_count} | docs=${board.skipped_doc_count}`,
    );
  }
}

main();