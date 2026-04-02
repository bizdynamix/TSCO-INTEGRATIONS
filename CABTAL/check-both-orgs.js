const fs = require("fs");
const T = JSON.parse(fs.readFileSync("monday-secret.json", "utf8")).MONDAY_API_TOKEN;

async function gql(q, v = {}) {
    const r = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { Authorization: T, "Content-Type": "application/json", "API-Version": "2024-01" },
        body: JSON.stringify({ query: q, variables: v }),
    });
    const d = await r.json();
    if (d.errors) console.error(JSON.stringify(d.errors));
    return d.data;
}

async function run() {
    // Future Orgs board
    const d1 = await gql(`{
        boards(ids:[18400425898]) {
            id name
            columns { id title type }
            groups { id title }
            items_page(limit:100) {
                items { id name group{id title} column_values{id text value} }
            }
        }
    }`);
    const b1 = d1.boards[0];
    console.log("=== Future CABTAL RM Organizations (18400425898) ===");
    console.log("Groups:", b1.groups.map(g => g.id + " '" + g.title + "'").join(" | "));
    console.log("Columns:");
    b1.columns.forEach(c => console.log("  [" + c.id + "] " + c.title + " (" + c.type + ")"));
    console.log("Items (" + b1.items_page.items.length + "):");
    b1.items_page.items.forEach(i => {
        const vals = i.column_values.filter(c => c.text && c.text !== "null").map(c => c.id + "=" + c.text).join(" | ");
        console.log("  [" + i.id + "] " + i.name + " group=" + i.group.title + (vals ? "\n    " + vals : ""));
    });

    // Legacy Orgs board
    const d2 = await gql(`{
        boards(ids:[18231906226]) {
            id name
            columns { id title type }
            groups { id title }
            items_page(limit:200) {
                items { id name group{id title} column_values{id text value} }
            }
        }
    }`);
    const b2 = d2.boards[0];
    console.log("\n=== CABTAL RM Organizations LEGACY (18231906226) ===");
    console.log("Groups:", b2.groups.map(g => g.id + " '" + g.title + "'").join(" | "));
    console.log("Columns:");
    b2.columns.forEach(c => console.log("  [" + c.id + "] " + c.title + " (" + c.type + ")"));
    console.log("Items (" + b2.items_page.items.length + "):");
    b2.items_page.items.forEach(i => {
        const vals = i.column_values.filter(c => c.text && c.text !== "null").map(c => c.id + "=" + c.text).join(" | ");
        console.log("  [" + i.id + "] " + i.name + " group=" + i.group.title + (vals ? "\n    " + vals : ""));
    });
}
run().catch(console.error);
