const fs = require("fs");
const T = JSON.parse(fs.readFileSync("monday-secret.json", "utf8")).MONDAY_API_TOKEN;

async function gql(query) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: T, "Content-Type": "application/json", "API-Version": "2024-01" },
    body: JSON.stringify({ query }),
  });
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}

async function run() {
  // Find all CABTAL / Integration boards
  const all = await gql(`query { boards(limit: 200) { id name } }`);
  const cabtal = all.boards.filter(b => /integration|cabtal/i.test(b.name));
  console.log("CABTAL/Integration boards found:");
  cabtal.forEach(b => console.log(`  [${b.id}] ${b.name}`));

  // Explore each one
  for (const board of cabtal) {
    const data = await gql(`query {
      boards(ids: ["${board.id}"]) {
        id name
        columns { id title type }
        groups { id title }
        items_page(limit: 3) { items { id name group { id title } } }
      }
    }`);
    const b = data.boards?.[0];
    if (!b) continue;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`BOARD: ${b.name}  (id: ${b.id})`);
    console.log("── Groups ─────────────────────────────");
    b.groups.forEach(g => console.log(`  [${g.id.padEnd(22)}] ${g.title}`));
    console.log("── Columns (key) ──────────────────────");
    b.columns.forEach(c => console.log(`  [${c.id.padEnd(22)}] ${c.title.padEnd(28)} ${c.type}`));
    console.log(`── Items: ${b.items_page.items.length} (showing up to 3)`);
    b.items_page.items.forEach(i => console.log(`  "${i.name}"  group="${i.group.title}"`));
  }
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
