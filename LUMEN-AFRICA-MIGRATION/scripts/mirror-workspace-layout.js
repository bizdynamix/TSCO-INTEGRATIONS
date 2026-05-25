/**
 * mirror-workspace-layout.js
 *
 * Mirrors the folder hierarchy of the SC LuminAfrica workspace (US id: 11389699,
 * top-level folder id: 16389498 "LuminAfrica") into the EU instance workspace 5927902.
 *
 * What this script does:
 *   1. Creates the 7-folder hierarchy in EU workspace 5927902 (idempotent — skips
 *      folders that already exist by name at the correct level).
 *   2. Prints a Board Placement Guide listing exactly which EU boards should be
 *      dragged into which folder in the Monday UI (the API has no move-board-to-
 *      folder mutation).
 *
 * Usage:
 *   node scripts/mirror-workspace-layout.js
 *   node scripts/mirror-workspace-layout.js --dry-run   (print plan, no API calls)
 */

import { gql, loadSecret, delay, parseArgs } from "./lib.js";

const EU_WORKSPACE_ID = "5927902";

// Folder hierarchy to create (order matters — parents must be created before children)
// null parentName = top-level folder
const FOLDER_PLAN = [
  { name: "LuminAfrica",            color: "SOFIA_PINK",     parentName: null },
  { name: "Email Template",         color: null,             parentName: null },
  { name: "RESOURCE MOBILISATION",  color: "DONE_GREEN",     parentName: "LuminAfrica" },
  { name: "PROJECT MANAGEMENT",     color: "WORKING_ORANGE", parentName: "LuminAfrica" },
  { name: "OPERATIONS",             color: "INDIGO",         parentName: "LuminAfrica" },
  { name: "PERSONAL BOARDS",        color: "DARK_RED",       parentName: "LuminAfrica" },
  { name: "EVENTS",                 color: null,             parentName: "RESOURCE MOBILISATION" },
];

// Board-to-folder mapping, derived from the US workspace structure.
// Key = EU board name (exact match), Value = folder name to place it in (null = no folder / stay at root)
const BOARD_FOLDER_MAP = {
  // PROJECT MANAGEMENT
  "HWW Workflow":                                      "PROJECT MANAGEMENT",
  "TWFTW Workflow":                                    "PROJECT MANAGEMENT",
  "BIBLICA Workflow":                                  "PROJECT MANAGEMENT",
  "SIL Workflow":                                      "PROJECT MANAGEMENT",
  "BSSA Workflow":                                     "PROJECT MANAGEMENT",
  "WSA Workflow":                                      "PROJECT MANAGEMENT",
  "WSA-LA PROJECTS ***SENSITIVE***":                   "PROJECT MANAGEMENT",
  "HWW-LA PROJECTS 2025 ***SENSITIVE***":              "PROJECT MANAGEMENT",
  "TWFTW-LA PROJECTS 2025 ***SENSITIVE***":            "PROJECT MANAGEMENT",
  "BIBLICA-LA PROJECTS 2025 ***SENSITIVE***":          "PROJECT MANAGEMENT",
  "SIL-LA PROJECTS ***SENSITIVE***":                   "PROJECT MANAGEMENT",
  "BSSA-LA PROJECTS ***SENSITIVE***":                  "PROJECT MANAGEMENT",
  "LuminAfrica MASTER PB Language Board":              "PROJECT MANAGEMENT",
  "REV79 Project Data":                                "PROJECT MANAGEMENT",
  "Rev 79 Report Status Updates":                      "PROJECT MANAGEMENT",
  "PROJECT CONTACTS":                                  "PROJECT MANAGEMENT",
  "❇️ LA PROJECTS MAIN BOARD ***SENSITIVE***":         "PROJECT MANAGEMENT",

  // EVENTS (child of RESOURCE MOBILISATION)
  "Event Planning":                                    "EVENTS",
  "Event Planning Checklist":                          "EVENTS",
  "Event RSVP Process":                                "EVENTS",

  // OPERATIONS
  "Steering Committee Dashboard":                      "OPERATIONS",

  // Email Template folder (top-level)
  "Email Template":                                    "Email Template",

  // Subitems stay at root (no folder in US either)
  "Subitems of Event Planning":                        null,
  "Subitems of Rev 79 Report Status Updates":          null,
  "Subitems of Steering Committee Dashboard":          null,
  "Subitems of ❇️ LA PROJECTS MAIN BOARD ***SENSITIVE***": null,
  "Subitems of HWW-LA PROJECTS 2025 ***SENSITIVE***":  null,
  "Subitems of TWFTW-LA PROJECTS 2025 ***SENSITIVE***": null,
  "Subitems of BIBLICA-LA PROJECTS 2025 ***SENSITIVE***": null,
  "Subitems of SIL-LA PROJECTS ***SENSITIVE***":       null,
  "Subitems of BSSA-LA PROJECTS ***SENSITIVE***":      null,
  "Subitems of WSA-LA PROJECTS ***SENSITIVE***":       null,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const secrets = loadSecret();
  const token = secrets.MONDAY_API_TOKEN_EU;

  if (!token) {
    console.error("MONDAY_API_TOKEN_EU is not set in monday-secret.json");
    process.exit(1);
  }

  // ── 1. Fetch existing EU folders ──────────────────────────────────────────
  console.log(`Fetching current EU workspace (${EU_WORKSPACE_ID}) folders…`);
  const existing = await gql(token, `
    query($wsId: [ID!]) {
      folders(workspace_ids: $wsId, limit: 100) {
        id name
        parent { id name }
        sub_folders { id name }
      }
    }
  `, { wsId: [EU_WORKSPACE_ID] });

  // Build a name→id map (keyed by name, sufficient for this flat-ish hierarchy)
  const existingByName = {};
  for (const f of existing.folders) {
    existingByName[f.name] = f;
  }

  // ── 2. Create folders in order ────────────────────────────────────────────
  console.log("\n── Folder creation ──");
  const createdIds = {}; // name → id (covers both pre-existing and newly created)

  for (const folder of FOLDER_PLAN) {
    const alreadyExists = existingByName[folder.name];
    if (alreadyExists) {
      createdIds[folder.name] = alreadyExists.id;
      console.log(`  SKIP  "${folder.name}" already exists (id: ${alreadyExists.id})`);
      continue;
    }

    const parentId = folder.parentName ? createdIds[folder.parentName] : undefined;

    if (dryRun) {
      console.log(`  DRY   create_folder("${folder.name}", color:${folder.color ?? "null"}, parent:${folder.parentName ?? "top-level"})`);
      createdIds[folder.name] = `__dry_${folder.name}__`;
      continue;
    }

    const variables = {
      workspaceId: EU_WORKSPACE_ID,
      name: folder.name,
    };
    if (folder.color) variables.color = folder.color;
    if (parentId) variables.parentFolderId = parentId;

    const colorArg = folder.color ? `, color: ${folder.color}` : "";
    const parentArg = parentId ? `, parent_folder_id: "${parentId}"` : "";

    const result = await gql(token, `
      mutation($workspaceId: ID!, $name: String!${folder.color ? ", $color: FolderColor" : ""}${parentId ? ", $parentFolderId: ID" : ""}) {
        create_folder(workspace_id: $workspaceId, name: $name${folder.color ? ", color: $color" : ""}${parentId ? ", parent_folder_id: $parentFolderId" : ""}) {
          id name
        }
      }
    `, variables);

    const newId = result.create_folder.id;
    createdIds[folder.name] = newId;
    console.log(`  CREATE "${folder.name}" → id: ${newId}${folder.parentName ? ` (inside "${folder.parentName}")` : " (top-level)"}`);
    await delay(500);
  }

  // ── 3. Fetch EU boards ────────────────────────────────────────────────────
  console.log("\nFetching EU boards…");
  const boardData = await gql(token, `
    query($wsId: [ID!]) {
      boards(workspace_ids: $wsId, limit: 100, state: active) {
        id name board_folder_id
      }
    }
  `, { wsId: [EU_WORKSPACE_ID] });

  const euBoards = boardData.boards;

  // ── 4. Print Board Placement Guide ────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  BOARD PLACEMENT GUIDE  (drag each board into its folder in");
  console.log("  the Monday UI — the API has no move-board-to-folder mutation)");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Group boards by target folder
  const byFolder = {};
  const unmapped = [];
  const alreadyPlaced = [];

  for (const board of euBoards) {
    const targetFolder = BOARD_FOLDER_MAP[board.name];

    if (targetFolder === undefined) {
      unmapped.push(board);
      continue;
    }

    if (board.board_folder_id !== null) {
      alreadyPlaced.push({ board, targetFolder });
      continue;
    }

    if (targetFolder === null) continue; // intentionally no folder

    if (!byFolder[targetFolder]) byFolder[targetFolder] = [];
    byFolder[targetFolder].push(board);
  }

  for (const [folderName, boards] of Object.entries(byFolder)) {
    const folderId = createdIds[folderName] ?? "?";
    console.log(`📁 ${folderName} (EU folder id: ${folderId})`);
    for (const b of boards) {
      console.log(`   • [${b.id}] ${b.name}`);
    }
    console.log();
  }

  if (alreadyPlaced.length > 0) {
    console.log("✅ Already in a folder (verify placement is correct):");
    for (const { board, targetFolder } of alreadyPlaced) {
      console.log(`   • [${board.id}] ${board.name}  →  should be in "${targetFolder}" (currently in folder ${board.board_folder_id})`);
    }
    console.log();
  }

  if (unmapped.length > 0) {
    console.log("⚠️  Boards with no mapping (check manually):");
    for (const b of unmapped) {
      console.log(`   • [${b.id}] ${b.name}`);
    }
    console.log();
  }

  // Print final folder hierarchy summary
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  TARGET FOLDER HIERARCHY (EU workspace 5927902)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`
LuminAfrica [SOFIA_PINK]  (id: ${createdIds["LuminAfrica"] ?? "?"})
├── RESOURCE MOBILISATION [DONE_GREEN]  (id: ${createdIds["RESOURCE MOBILISATION"] ?? "?"})
│   └── EVENTS  (id: ${createdIds["EVENTS"] ?? "?"})
├── PROJECT MANAGEMENT [WORKING_ORANGE]  (id: ${createdIds["PROJECT MANAGEMENT"] ?? "?"})
├── OPERATIONS [INDIGO]  (id: ${createdIds["OPERATIONS"] ?? "?"})
└── PERSONAL BOARDS [DARK_RED]  (id: ${createdIds["PERSONAL BOARDS"] ?? "?"})

Email Template  (id: ${createdIds["Email Template"] ?? "?"})  [top-level folder]
`);

  if (dryRun) {
    console.log("(dry-run — no folders were created)");
  } else {
    console.log("✅ Folders created. Move boards into folders in the Monday UI using the guide above.");
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
