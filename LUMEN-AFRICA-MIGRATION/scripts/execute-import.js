/**
 * execute-import.js
 *
 * Live EU import — reads data/board-*.json and creates boards, groups, columns,
 * and items in the Lumen Africa EU Monday workspace, then uploads binary files.
 *
 * Usage:
 *   node scripts/execute-import.js [--board-id <id>] [--dry-run]
 *
 * Flags:
 *   --board-id   Only import one board (by source board ID)
 *   --dry-run    Log what would happen without making API calls
 *
 * Output:
 *   reports/import-results.json — EU board/item IDs for validation + file upload pass
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { delay, ensureDir, gql, loadSecret, parseArgs, writeJson } from "./lib.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const REPORTS_DIR = new URL("../reports/", import.meta.url);
const RESULTS_PATH = new URL("../reports/import-results.json", import.meta.url);
const MANIFEST_PATH = new URL("../data/download-manifest.json", import.meta.url);

// Mirrors the classification rules in import-board.js
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

// Columns that should be created in EU (all except truly-skip ones)
const SKIP_CREATE = new Set(["builtin", "manual-subitems-replay", "manual-rebuild"]);

// Columns whose values should be set on create_item (standard writable columns)
const SKIP_VALUE = new Set([
  "builtin", "manual-subitems-replay", "manual-rebuild",
  "manual-user-mapping",              // people — no user map yet
  "create-column-and-upload-files-later", // file — uploaded separately
]);

// ---------------------------------------------------------------------------
// Column value extraction
// Converts source column_value shape → Monday create_item column_values format
// ---------------------------------------------------------------------------
function extractColumnValue(cv, type) {
  if (!cv.value && !cv.text) return null;
  try {
    switch (type) {
      case "text":
      case "long_text":
        return cv.text || null;

      case "numbers":
        return cv.text || null;

      case "date": {
        if (!cv.value) return null;
        const d = JSON.parse(cv.value);
        return d.date ? { date: d.date } : null;
      }

      case "status": {
        if (!cv.text) return null;
        return { label: cv.text };
      }

      case "email": {
        const e = cv.value ? JSON.parse(cv.value) : {};
        const addr = e.email || cv.text;
        if (!addr) return null;
        return { email: addr, text: e.text || addr };
      }

      case "link": {
        if (!cv.value) return null;
        const l = JSON.parse(cv.value);
        if (!l.url) return null;
        return { url: l.url, text: l.text || l.url };
      }

      case "phone": {
        if (!cv.value) return null;
        const p = JSON.parse(cv.value);
        if (!p.phone) return null;
        return { phone: p.phone, countryShortName: p.countryShortName || "US" };
      }

      case "dropdown": {
        if (!cv.text) return null;
        return { labels: cv.text.split(",").map((l) => l.trim()).filter(Boolean) };
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Column defaults for create_column
// Extracts label/unit settings from settings_str for status + numbers columns
// ---------------------------------------------------------------------------
function buildColumnDefaults(col) {
  if (!col.settings_str || col.settings_str === "{}") return undefined;
  try {
    const settings = JSON.parse(col.settings_str);
    if (col.type === "status" && settings.labels) {
      return JSON.stringify({ labels: settings.labels });
    }
    if (col.type === "dropdown" && settings.labels) {
      return JSON.stringify({ labels: settings.labels });
    }
    if (col.type === "numbers" && settings.unit) {
      return JSON.stringify({ unit: settings.unit });
    }
  } catch {
    // ignore
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Monday API mutations
// ---------------------------------------------------------------------------
async function createBoardInEU(token, workspaceId, { board_name, board_kind, description }, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] create_board: "${board_name}" in workspace ${workspaceId}`);
    return "dry-board-id";
  }
  const data = await gql(token, `
    mutation ($name: String!, $kind: BoardKind!, $wsId: ID!, $desc: String) {
      create_board(board_name: $name, board_kind: $kind, workspace_id: $wsId, description: $desc) {
        id
      }
    }
  `, { name: board_name, kind: board_kind, wsId: String(workspaceId), desc: description || null });
  return data.create_board.id;
}

async function fetchBoardGroups(token, boardId) {
  const data = await gql(token, `
    query ($id: ID!) { boards(ids: [$id]) { groups { id title } } }
  `, { id: String(boardId) });
  return data.boards[0]?.groups ?? [];
}

async function createGroupInEU(token, boardId, groupName, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] create_group: "${groupName}"`);
    return `dry-group-${groupName.replace(/\s+/g, "-")}`;
  }
  const data = await gql(token, `
    mutation ($boardId: ID!, $name: String!) {
      create_group(board_id: $boardId, group_name: $name) { id }
    }
  `, { boardId: String(boardId), name: groupName });
  return data.create_group.id;
}

async function createColumnInEU(token, boardId, col, dryRun) {
  const defaults = buildColumnDefaults(col);
  if (dryRun) {
    console.log(`  [dry-run] create_column: "${col.title}" (${col.type})`);
    return `dry-col-${col.id}`;
  }
  const data = await gql(token, `
    mutation ($boardId: ID!, $title: String!, $type: ColumnType!, $defaults: JSON) {
      create_column(board_id: $boardId, title: $title, column_type: $type, defaults: $defaults) {
        id
      }
    }
  `, { boardId: String(boardId), title: col.title, type: col.type, defaults });
  return data.create_column.id;
}

async function createItemInEU(token, boardId, groupId, itemName, columnValues, dryRun) {
  if (dryRun) {
    const colCount = Object.keys(columnValues).length;
    console.log(`  [dry-run] create_item: "${itemName}" (${colCount} column values)`);
    return `dry-item-${itemName.replace(/\s+/g, "-")}`;
  }
  const cvJson = JSON.stringify(columnValues);
  const data = await gql(token, `
    mutation ($boardId: ID!, $groupId: String!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, group_id: $groupId, item_name: $name, column_values: $cv) {
        id
      }
    }
  `, { boardId: String(boardId), groupId, name: itemName, cv: cvJson });
  return data.create_item.id;
}

// ---------------------------------------------------------------------------
// File upload via multipart form-data (Node 20+ native FormData/Blob)
// ---------------------------------------------------------------------------
async function uploadFileToItem(token, euItemId, euColId, filePath, filename, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] upload_file: "${filename}" → item ${euItemId} col ${euColId}`);
    return "dry-asset-id";
  }

  const fileBuffer = readFileSync(filePath);
  const blob = new Blob([fileBuffer]);

  const form = new FormData();
  form.append(
    "query",
    `mutation ($file: File!) {
      add_file_to_column(item_id: ${euItemId}, column_id: "${euColId}", file: $file) {
        id
      }
    }`,
  );
  form.append("variables[file]", blob, filename);

  const resp = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: {
      Authorization: token,
      "API-Version": "2024-01",
    },
    body: form,
  });

  const result = await resp.json();
  if (!resp.ok || result.errors) {
    throw new Error(`File upload error: ${JSON.stringify(result.errors ?? result)}`);
  }
  return result.data?.add_file_to_column?.id;
}

// ---------------------------------------------------------------------------
// Board import orchestration
// ---------------------------------------------------------------------------
async function fetchWorkspaceBoards(token, workspaceId) {
  const data = await gql(token, `
    query ($wsId: ID!) { boards(workspace_ids: [$wsId], limit: 200) { id name } }
  `, { wsId: String(workspaceId) });
  return data.boards ?? [];
}

async function importBoard(token, workspaceId, boardExport, dryRun, existingBoardNames = new Set()) {
  const { board, groups, columns, items } = boardExport;
  console.log(`\n── Board: "${board.name}" (source ${board.id}) ──`);

  if (!dryRun && existingBoardNames.has(board.name)) {
    console.log(`  ⊘ Skipping — a board named "${board.name}" already exists in EU workspace. Use --force to override.`);
    return null;
  }

  // 1. Create board
  const euBoardId = await createBoardInEU(token, workspaceId, {
    board_name: board.name,
    board_kind: board.board_kind,
    description: board.description,
  }, dryRun);
  await delay();
  console.log(`  ✓ Board → EU id: ${euBoardId}`);

  // 2. Note the auto-created default group (will be an extra empty group — cosmetic)
  let autoGroupId = null;
  if (!dryRun) {
    const existing = await fetchBoardGroups(token, euBoardId);
    autoGroupId = existing[0]?.id ?? null;
    await delay();
  }

  // 3. Create groups — build source→EU map
  const groupIdMap = {};
  for (const group of groups) {
    const euGroupId = await createGroupInEU(token, euBoardId, group.title, dryRun);
    groupIdMap[group.id] = euGroupId;
    await delay();
  }
  console.log(`  ✓ Groups created: ${groups.length} (+ 1 default auto-group will need cleanup)`);

  // 4. Create columns — skip builtin/subtasks/manual-rebuild
  const colTypeMap = Object.fromEntries(columns.map((c) => [c.id, c.type]));
  const colStrategyMap = Object.fromEntries(
    columns.map((c) => [c.id, COLUMN_RULES[c.type] ?? "standard-create"]),
  );

  const columnIdMap = {};
  let colCreated = 0;
  let colSkipped = 0;

  for (const col of columns) {
    const strategy = colStrategyMap[col.id];
    if (SKIP_CREATE.has(strategy)) {
      colSkipped++;
      continue;
    }
    try {
      const euColId = await createColumnInEU(token, euBoardId, col, dryRun);
      columnIdMap[col.id] = euColId;
      colCreated++;
      await delay();
    } catch (err) {
      console.warn(`  ⚠ Column "${col.title}" (${col.type}) failed: ${err.message}`);
      colSkipped++;
    }
  }
  console.log(`  ✓ Columns: ${colCreated} created, ${colSkipped} skipped`);

  // 5. Create items
  const itemResults = [];
  let itemsFailed = 0;

  for (const item of items ?? []) {
    const euGroupId = groupIdMap[item.group.id];
    if (!euGroupId) {
      console.warn(`  ⚠ No EU group for item "${item.name}" (source group ${item.group.id})`);
      itemsFailed++;
      continue;
    }

    // Build column values — only for standard-create columns with a value
    const columnValues = {};
    for (const cv of item.column_values ?? []) {
      const strategy = colStrategyMap[cv.id];
      if (!strategy || SKIP_VALUE.has(strategy)) continue;
      const euColId = columnIdMap[cv.id];
      if (!euColId) continue;
      const val = extractColumnValue(cv, colTypeMap[cv.id]);
      if (val !== null) {
        columnValues[euColId] = val;
      }
    }

    let euItemId = null;
    try {
      euItemId = await createItemInEU(token, euBoardId, euGroupId, item.name, columnValues, dryRun);
    } catch (err) {
      console.warn(`  ⚠ Item "${item.name}" failed: ${err.message}`);
      itemsFailed++;
    }
    await delay();

    itemResults.push({
      source_item_id: item.id,
      eu_item_id: euItemId,
      name: item.name,
    });
  }

  const itemsOk = itemResults.filter((r) => r.eu_item_id).length;
  console.log(`  ✓ Items: ${itemsOk} created${itemsFailed > 0 ? `, ${itemsFailed} failed` : ""}`);

  // 6. Collect pending file uploads (matched from download-manifest later)
  const pendingFiles = [];
  for (const item of items ?? []) {
    const result = itemResults.find((r) => r.source_item_id === item.id);
    if (!result?.eu_item_id) continue;
    for (const cv of item.column_values ?? []) {
      if (cv.type !== "file" || !cv.value) continue;
      try {
        const parsed = JSON.parse(cv.value);
        for (const f of parsed.files ?? []) {
          if (f.assetId) {
            pendingFiles.push({
              source_item_id: item.id,
              eu_item_id: result.eu_item_id,
              source_col_id: cv.id,
              eu_col_id: columnIdMap[cv.id] ?? null,
              asset_id: String(f.assetId),
            });
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    source_board_id: board.id,
    board_name: board.name,
    eu_board_id: euBoardId,
    auto_group_id: autoGroupId,
    group_id_map: groupIdMap,
    column_id_map: columnIdMap,
    items: itemResults,
    files_pending: pendingFiles,
    manual_follow_up: [
      autoGroupId ? `Delete the auto-created default group (id: ${autoGroupId}) in EU board ${euBoardId}` : null,
      columns.some((c) => c.type === "people") ? "Assign people column values once SC→EU user map is available" : null,
      columns.some((c) => c.type === "subtasks") ? "Re-link subitems board in Monday UI after all boards are imported" : null,
      pendingFiles.length > 0 ? `${pendingFiles.length} binary file(s) queued for upload — run file-upload pass` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// File upload pass — reads import-results + download-manifest, uploads files
// ---------------------------------------------------------------------------
async function uploadPendingFiles(token, boardResults, dryRun) {
  if (!existsSync(MANIFEST_PATH)) {
    console.log("\nNo download-manifest.json found — skipping file upload pass.");
    return [];
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const downloadedFiles = manifest.files.filter((f) => f.status === "downloaded" && f.path);

  // Build lookup: source_item_id + source_col_id → { eu_item_id, eu_col_id }
  const pendingLookup = new Map();
  for (const board of boardResults) {
    for (const pf of board.files_pending) {
      const key = `${pf.source_item_id}:${pf.source_col_id}`;
      pendingLookup.set(key, {
        eu_item_id: pf.eu_item_id,
        eu_col_id: pf.eu_col_id,
      });
    }
  }

  console.log(`\n── File Upload Pass (${downloadedFiles.length} downloaded files) ──`);
  const uploadResults = [];

  for (const file of downloadedFiles) {
    const key = `${file.item_id}:${file.column_id}`;
    const pending = pendingLookup.get(key);
    if (!pending) {
      console.log(`  ⊘ Skipping "${file.name}" — no matching pending entry`);
      continue;
    }
    if (!pending.eu_col_id) {
      console.warn(`  ⚠ "${file.name}" — eu_col_id not mapped, skipping`);
      continue;
    }
    if (!existsSync(file.path)) {
      console.warn(`  ⚠ "${file.name}" — local file not found at ${file.path}`);
      continue;
    }

    try {
      const assetId = await uploadFileToItem(
        token,
        pending.eu_item_id,
        pending.eu_col_id,
        file.path,
        file.name,
        dryRun,
      );
      console.log(`  ✓ Uploaded "${file.name}" → EU asset ${assetId}`);
      uploadResults.push({ file: file.name, eu_item_id: pending.eu_item_id, eu_asset_id: assetId, status: "uploaded" });
    } catch (err) {
      console.warn(`  ✗ Failed to upload "${file.name}": ${err.message}`);
      uploadResults.push({ file: file.name, eu_item_id: pending.eu_item_id, status: "failed", error: err.message });
    }
    await delay();
  }

  return uploadResults;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function exportedBoardFiles() {
  return readdirSync(DATA_DIR.pathname)
    .filter((name) => /^board-\d+\.json$/.test(name))
    .map((name) => new URL(`../data/${name}`, import.meta.url));
}

function loadJson(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, "utf8"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadSecret();
  const dryRun = Boolean(args["dry-run"]);
  const boardIdFilter = args["board-id"] ? String(args["board-id"]) : null;

  const { MONDAY_API_TOKEN_EU: token, MONDAY_WORKSPACE_ID_EU: workspaceId } = config;

  if (!token || !workspaceId) {
    throw new Error("MONDAY_API_TOKEN_EU and MONDAY_WORKSPACE_ID_EU must be set in monday-secret.json");
  }

  if (dryRun) {
    console.log("=== DRY-RUN MODE — no EU writes will be made ===\n");
  } else {
    console.log("=== LIVE IMPORT — writing to EU Monday workspace ===\n");
  }

  const boardIdSet = boardIdFilter
    ? new Set(String(boardIdFilter).split(",").map((id) => id.trim()).filter(Boolean))
    : null;
  const boardFiles = exportedBoardFiles().filter((url) => {
    if (!boardIdSet) return true;
    return [...boardIdSet].some((id) => url.pathname.endsWith(`board-${id}.json`));
  });

  if (boardFiles.length === 0) {
    throw new Error(boardIdFilter
      ? `No exported board JSON found for board-id ${boardIdFilter}`
      : "No exported board JSON files found in data/");
  }

  console.log(`Boards to import: ${boardFiles.length}`);

  ensureDir(REPORTS_DIR.pathname);

  // Fetch existing EU board names to skip duplicates (unless --force)
  let existingBoardNames = new Set();
  if (!dryRun && !args["force"]) {
    const existing = await fetchWorkspaceBoards(token, workspaceId);
    existingBoardNames = new Set(existing.map((b) => b.name));
    if (existingBoardNames.size > 0) {
      console.log(`Existing EU boards (will skip duplicates): ${[...existingBoardNames].join(", ")}`);
    }
  }

  const boardResults = [];

  for (const fileUrl of boardFiles) {
    const boardExport = loadJson(fileUrl);
    const result = await importBoard(token, workspaceId, boardExport, dryRun, existingBoardNames);
    if (result) boardResults.push(result);
  }

  // File upload pass (only when all boards done, or single board)
  const uploadResults = await uploadPendingFiles(token, boardResults, dryRun);

  // Write results
  const output = {
    executed_at: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "live",
    eu_workspace_id: workspaceId,
    boards: boardResults,
    file_uploads: uploadResults,
  };

  writeJson(RESULTS_PATH.pathname, output);
  console.log(`\n✓ Results written to reports/import-results.json`);

  // Summary
  console.log("\n=== Summary ===");
  for (const board of boardResults) {
    const itemsOk = board.items.filter((i) => i.eu_item_id).length;
    console.log(`  ${board.board_name}: EU board ${board.eu_board_id} | ${itemsOk}/${board.items.length} items`);
    for (const note of board.manual_follow_up) {
      console.log(`    → ${note}`);
    }
  }
  if (uploadResults.length > 0) {
    const ok = uploadResults.filter((r) => r.status === "uploaded").length;
    console.log(`\n  Files: ${ok}/${uploadResults.length} uploaded`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
