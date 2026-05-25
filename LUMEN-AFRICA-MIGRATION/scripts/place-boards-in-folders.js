/**
 * place-boards-in-folders.js
 *
 * Uses the Monday.com MCP server (https://mcp.monday.com/mcp) with the EU token
 * to move all EU workspace boards into their correct folders via `move_object`.
 *
 * The Monday.com public GraphQL API has no move-board-to-folder mutation; the MCP
 * server exposes this capability through its own `move_board` action internally.
 *
 * Usage:
 *   node scripts/place-boards-in-folders.js
 *   node scripts/place-boards-in-folders.js --dry-run
 */

import { loadSecret, delay, parseArgs } from "./lib.js";

const MCP_URL = "https://mcp.monday.com/mcp";
const EU_WORKSPACE_ID = "5927902";

// EU folder IDs created by mirror-workspace-layout.js
const FOLDERS = {
  PROJECT_MANAGEMENT: "3028997",
  RESOURCE_MOBILISATION: "3028996",
  EVENTS: "3029000",
  OPERATIONS: "3028998",
  PERSONAL_BOARDS: "3028999",
  EMAIL_TEMPLATE: "3028995",
  LUMIN_AFRICA: "3028994",
};

// Board name → folder ID mapping (derived from US workspace structure)
// Boards not listed here stay at root (subitems boards have no folder in US either)
const BOARD_FOLDER_MAP = {
  // PROJECT MANAGEMENT
  "HWW Workflow":                                          FOLDERS.PROJECT_MANAGEMENT,
  "TWFTW Workflow":                                        FOLDERS.PROJECT_MANAGEMENT,
  "BIBLICA Workflow":                                      FOLDERS.PROJECT_MANAGEMENT,
  "SIL Workflow":                                          FOLDERS.PROJECT_MANAGEMENT,
  "BSSA Workflow":                                         FOLDERS.PROJECT_MANAGEMENT,
  "WSA Workflow":                                          FOLDERS.PROJECT_MANAGEMENT,
  "WSA-LA PROJECTS ***SENSITIVE***":                       FOLDERS.PROJECT_MANAGEMENT,
  "HWW-LA PROJECTS 2025 ***SENSITIVE***":                  FOLDERS.PROJECT_MANAGEMENT,
  "TWFTW-LA PROJECTS 2025 ***SENSITIVE***":                FOLDERS.PROJECT_MANAGEMENT,
  "BIBLICA-LA PROJECTS 2025 ***SENSITIVE***":              FOLDERS.PROJECT_MANAGEMENT,
  "SIL-LA PROJECTS ***SENSITIVE***":                       FOLDERS.PROJECT_MANAGEMENT,
  "BSSA-LA PROJECTS ***SENSITIVE***":                      FOLDERS.PROJECT_MANAGEMENT,
  "LuminAfrica MASTER PB Language Board":                  FOLDERS.PROJECT_MANAGEMENT,
  "REV79 Project Data":                                    FOLDERS.PROJECT_MANAGEMENT,
  "Rev 79 Report Status Updates":                          FOLDERS.PROJECT_MANAGEMENT,
  "PROJECT CONTACTS":                                      FOLDERS.PROJECT_MANAGEMENT,
  "❇️ LA PROJECTS MAIN BOARD ***SENSITIVE***":             FOLDERS.PROJECT_MANAGEMENT,

  // EVENTS (child of RESOURCE MOBILISATION)
  "Event Planning":                                        FOLDERS.EVENTS,
  "Event Planning Checklist":                              FOLDERS.EVENTS,
  "Event RSVP Process":                                    FOLDERS.EVENTS,

  // OPERATIONS
  "Steering Committee Dashboard":                          FOLDERS.OPERATIONS,

  // Email Template (top-level folder)
  "Email Template":                                        FOLDERS.EMAIL_TEMPLATE,
};

// ─── MCP client ─────────────────────────────────────────────────────────────

async function mcpInit(token) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "place-boards-in-folders", version: "1.0" },
      },
      id: 0,
    }),
  });
  if (!res.ok) throw new Error(`MCP init failed: ${res.status}`);
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No session ID returned from MCP init");
  return sessionId;
}

async function mcpMoveBoard(token, sessionId, boardId, folderId, callId) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "move_object",
        arguments: {
          id: boardId,
          objectType: "Board",
          parentFolderId: folderId,
          workspaceId: EU_WORKSPACE_ID,
        },
      },
      id: callId,
    }),
  });

  const text = await res.text();
  const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
  if (dataLines.length === 0) throw new Error(`No data in MCP response: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(dataLines[0].slice(6));
  if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);

  const structured = parsed.result?.structuredContent ?? {};
  return structured;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const secrets = loadSecret();
  const token = secrets.MONDAY_API_TOKEN_EU;

  if (!token) {
    console.error("MONDAY_API_TOKEN_EU not set in monday-secret.json");
    process.exit(1);
  }

  // Fetch current EU board list
  const { gql } = await import("./lib.js");
  const boardData = await gql(token, `
    query {
      boards(workspace_ids: [${EU_WORKSPACE_ID}], limit: 100, state: active) {
        id name board_folder_id
      }
    }
  `);

  const boards = boardData.boards;
  const toMove = [];
  const alreadyPlaced = [];
  const noMapping = [];

  for (const board of boards) {
    const targetFolder = BOARD_FOLDER_MAP[board.name];
    if (targetFolder === undefined) {
      noMapping.push(board);
      continue;
    }
    if (board.board_folder_id === targetFolder) {
      alreadyPlaced.push({ board, targetFolder });
      continue;
    }
    // Not in the right folder (or not in any folder) — queue for move
    toMove.push({ board, targetFolder });
  }

  // Print plan
  const folderName = (id) => Object.entries(FOLDERS).find(([, v]) => v === id)?.[0] ?? id;

  console.log(`\n── Board placement plan ──`);
  if (toMove.length === 0) {
    console.log("  All boards already in correct folders.");
  } else {
    for (const { board, targetFolder } of toMove) {
      console.log(`  MOVE  [${board.id}] "${board.name}"  →  ${folderName(targetFolder)} (${targetFolder})`);
    }
  }
  if (alreadyPlaced.length > 0) {
    console.log(`\n  Already placed (${alreadyPlaced.length} boards):`);
    for (const { board } of alreadyPlaced) {
      console.log(`  SKIP  [${board.id}] "${board.name}"`);
    }
  }
  if (noMapping.length > 0) {
    console.log(`\n  No mapping — staying at root (${noMapping.length} boards):`);
    for (const b of noMapping) {
      console.log(`  ROOT  [${b.id}] "${b.name}"`);
    }
  }

  if (dryRun || toMove.length === 0) {
    if (dryRun) console.log("\n(dry-run — no boards moved)");
    return;
  }

  // Initialize MCP session
  console.log("\n── Initializing MCP session… ──");
  let sessionId;
  try {
    sessionId = await mcpInit(token);
    console.log(`  Session: ${sessionId.slice(0, 16)}…`);
  } catch (err) {
    console.error("Failed to init MCP session:", err.message);
    process.exit(1);
  }

  // Move boards
  console.log("\n── Moving boards ──");
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < toMove.length; i++) {
    const { board, targetFolder } = toMove[i];
    try {
      const result = await mcpMoveBoard(token, sessionId, board.id, targetFolder, i + 1);
      console.log(`  ✅  [${board.id}] "${board.name}"  →  ${folderName(targetFolder)}`);
      ok++;
    } catch (err) {
      console.error(`  ❌  [${board.id}] "${board.name}"  —  ${err.message}`);
      failed++;
    }
    await delay(300);
  }

  console.log(`\n── Done: ${ok} moved, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
