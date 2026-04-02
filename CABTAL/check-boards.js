const fs = require("fs");
const path = require("path");

const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await res.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors));
  return payload.data;
}

async function main() {
  const boards = [
    ["18400425732", "FUTURE CABTAL RM People (Donors)  ← target board"],
    ["18231902551", "LEGACY CABTAL RM People (Donors)  ← should be untouched"],
  ];

  for (const [boardId, label] of boards) {
    console.log(`\n════ ${label} ════`);
    const d = await gql(
      `query($id: ID!) { boards(ids: [$id]) {
          columns(types: [phone]) { id title }
          groups { id title }
      }}`,
      { id: boardId }
    );
    const b = d.boards[0];
    console.log("  Phone cols:", b.columns.map(c => `${c.id}="${c.title}"`).join(", ") || "(none)");
    console.log("  Groups:");
    b.groups.forEach(g => console.log(`    [${g.id}] ${g.title}`));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
