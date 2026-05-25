/**
 * delete-boards.js
 * Deletes boards from EU Monday workspace by ID.
 * Usage: node scripts/delete-boards.js --board-id 123,456,789
 *        node scripts/delete-boards.js --board-id 123 --dry-run
 *
 * Prompts for confirmation before deleting.
 */

import { createInterface } from "readline";
import { delay, gql, loadSecret, parseArgs } from "./lib.js";

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] === true;
const boardIdArg = args["board-id"];

if (!boardIdArg) {
  console.error("Usage: node scripts/delete-boards.js --board-id 123,456,789 [--dry-run]");
  process.exit(1);
}

const boardIds = String(boardIdArg).split(",").map((id) => id.trim()).filter(Boolean);

const secret = loadSecret();
const token = secret.MONDAY_API_TOKEN_EU;
if (!token) {
  console.error("Missing MONDAY_API_TOKEN_EU in monday-secret.json");
  process.exit(1);
}

async function fetchBoardInfo(token, boardId) {
  try {
    const data = await gql(token, `
      query ($id: ID!) {
        boards(ids: [$id]) { id name state workspace { id name } }
      }
    `, { id: String(boardId) });
    return data.boards[0] ?? null;
  } catch {
    return null;
  }
}

async function deleteBoardInEU(token, boardId, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] delete_board(${boardId})`);
    return true;
  }
  await gql(token, `
    mutation ($id: ID!) {
      delete_board(board_id: $id) { id }
    }
  `, { id: String(boardId) });
  return true;
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Main
console.log(`\nBoard IDs to delete: ${boardIds.join(", ")}`);
console.log(`Dry-run: ${dryRun}\n`);

// Fetch board info for each ID
console.log("Fetching board info...");
const boardInfos = [];
for (const id of boardIds) {
  await delay(300);
  const info = await fetchBoardInfo(token, id);
  if (info) {
    boardInfos.push(info);
    console.log(`  ${id}: "${info.name}" [${info.state}] (workspace: ${info.workspace?.name ?? "unknown"})`);
  } else {
    console.log(`  ${id}: NOT FOUND or error`);
  }
}

if (boardInfos.length === 0) {
  console.log("\nNo boards found to delete.");
  process.exit(0);
}

if (!dryRun) {
  const answer = await prompt(`\nDelete ${boardInfos.length} board(s)? Type YES to confirm: `);
  if (answer !== "YES") {
    console.log("Aborted.");
    process.exit(0);
  }
}

console.log("\nDeleting boards...");
let deleted = 0;
let failed = 0;
for (const info of boardInfos) {
  await delay();
  try {
    await deleteBoardInEU(token, info.id, dryRun);
    console.log(`  ✓ Deleted "${info.name}" (${info.id})`);
    deleted++;
  } catch (err) {
    console.error(`  ✗ Failed to delete "${info.name}" (${info.id}): ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`);
