/**
 * check-monday-connection.js
 *
 * Pre-flight check: validates both the US and EU Monday API tokens from
 * monday-secret.json, then prints guidance on which approach to use for
 * the current session (MCP tools vs direct API scripts).
 *
 * Run at the start of any Monday-related work session:
 *   node scripts/check-monday-connection.js
 *   npm run check-monday
 *
 * Exit codes:
 *   0 — at least one token is valid
 *   1 — both tokens invalid / missing
 */

import { gql, loadSecret } from "./lib.js";

const PING_QUERY = `query { me { id name email account { id name } } }`;

async function checkToken(label, token) {
  if (!token) {
    return { label, ok: false, reason: "token not set in monday-secret.json" };
  }
  try {
    const data = await gql(token, PING_QUERY);
    const me = data.me;
    return {
      label,
      ok: true,
      user: me.name,
      email: me.email,
      account: me.account.name,
      accountId: me.account.id,
    };
  } catch (err) {
    return { label, ok: false, reason: err.message.slice(0, 120) };
  }
}

function badge(ok) {
  return ok ? "✅" : "❌";
}

async function main() {
  const secrets = loadSecret();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Monday.com Connection Check");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const [us, eu] = await Promise.all([
    checkToken("US (api.monday.com)", secrets.MONDAY_API_TOKEN_US),
    checkToken("EU (api.monday.com)", secrets.MONDAY_API_TOKEN_EU),
  ]);

  for (const result of [us, eu]) {
    if (result.ok) {
      console.log(`${badge(true)}  ${result.label}`);
      console.log(`      user: ${result.user} <${result.email}>`);
      console.log(`      account: ${result.account} (id: ${result.accountId})\n`);
    } else {
      console.log(`${badge(false)}  ${result.label}`);
      console.log(`      reason: ${result.reason}\n`);
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  MCP Tool Status");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("  MCP tools (mcp_com_monday_mo_* / monday-us / monday-eu) are");
  console.log("  configured in .vscode/mcp.json and require a one-time token");
  console.log("  entry in VS Code. If MCP responds with 'Not authenticated':");
  console.log();
  console.log("  1. Open VS Code Command Palette (⌘⇧P)");
  console.log('  2. Run: "MCP: List Servers"');
  console.log('  3. Click "monday-us" → Enter the MONDAY_API_TOKEN_US value');
  console.log('  4. Click "monday-eu" → Enter the MONDAY_API_TOKEN_EU value');
  console.log("     (both tokens are in monday-secret.json)");
  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  When to use MCP tools vs direct API scripts");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("  USE MCP TOOLS (mcp_com_monday_mo_* or monday-us / monday-eu):");
  console.log("  • Browsing / reading boards, items, workspaces ad-hoc");
  console.log("  • One-off lookups (get a board, check a folder, find a user)");
  console.log("  • Creating single items/boards/groups interactively");
  console.log("  • Any operation where Copilot is making decisions inline");
  console.log();
  console.log("  USE DIRECT API SCRIPTS (node scripts/*):");
  console.log("  • Bulk operations (import, migrate, batch-create)");
  console.log("  • EU-specific operations (scripts read monday-secret.json)");
  console.log("  • Operations requiring pagination over hundreds of items");
  console.log("  • File uploads (multipart, not supported in MCP)");
  console.log("  • Anything that needs to run unattended / in CI");
  console.log();

  const anyOk = us.ok || eu.ok;
  if (!anyOk) {
    console.error("ERROR: No valid tokens found. Update monday-secret.json.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Check failed:", err.message);
  process.exit(1);
});
