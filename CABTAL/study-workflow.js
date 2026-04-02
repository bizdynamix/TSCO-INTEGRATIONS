const fs = require("fs");
const T = JSON.parse(
  fs.readFileSync("tmp/monday-secret.json", "utf8"),
).MONDAY_API_TOKEN;

async function q(query, vars = {}) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: T, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: vars }),
  });
  const data = await r.json();
  if (data.errors)
    console.error("API errors:", JSON.stringify(data.errors, null, 2));
  return data.data;
}

async function run() {
  // 1. Full structure of the Book Difficulty Multiplier board
  console.log("=== Board 18400742721: Book Difficulty Multiplier ===\n");
  const res = await q(`{
    boards(ids: [18400742721]) {
      id name
      columns { id title type settings_str }
      groups { id title }
      items_page(limit: 100) {
        items { id name group { id title } column_values { id text value } }
      }
    }
  }`);
  const board = res?.boards?.[0];
  if (!board) {
    console.log("No board found");
    return;
  }
  console.log("Columns:");
  board.columns.forEach((c) => {
    console.log(
      `  [${c.id}] ${c.title} (${c.type}) ${c.settings_str !== "{}" ? c.settings_str.substring(0, 200) : ""}`,
    );
  });
  console.log("\nGroups:");
  board.groups.forEach((g) => console.log(`  [${g.id}] ${g.title}`));
  console.log("\nItems (" + board.items_page.items.length + "):");
  board.items_page.items.forEach((item) => {
    const vals = item.column_values.filter((c) => c.text && c.text !== "null");
    console.log(
      `  "${item.name}" group="${item.group.title}" ${vals.map((c) => `${c.id}="${c.text}"`).join(" | ")}`,
    );
  });

  // 2. Template board formulas for reference
  console.log("\n\n=== Template Board Formulas ===\n");
  const res2 = await q(`{
    boards(ids: [18400742723]) {
      columns(ids: ["formula5","formula","formula3","formula9","formula8","dup__of_verses_day","numbers13","numbers6"]) {
        id title type settings_str
      }
    }
  }`);
  res2.boards[0].columns.forEach((c) => {
    console.log(`  [${c.id}] ${c.title}: ${c.settings_str}`);
  });

  // 3. Check existing project board (Americas Quechua NT) for these columns
  console.log(
    "\n\n=== Americas Quechua NT - numbers13/numbers6/formula5 ===\n",
  );
  const res3 = await q(`{
    boards(ids: [18401159007]) {
      columns(ids: ["numbers13","numbers6","formula5"]) {
        id title type settings_str
      }
      items_page(limit: 10) {
        items {
          name
          column_values(ids: ["numbers13","numbers6","formula5"]) {
            id text value
          }
        }
      }
    }
  }`);
  console.log(
    "Columns:",
    res3.boards[0].columns.map((c) => `[${c.id}] ${c.title}`),
  );
  console.log("\nItem values:");
  res3.boards[0].items_page.items.forEach((i) => {
    const m = i.column_values.find((c) => c.id === "numbers13")?.text || "—";
    const s = i.column_values.find((c) => c.id === "numbers6")?.text || "—";
    const eq = i.column_values.find((c) => c.id === "formula5")?.text || "—";
    console.log(
      `  ${i.name.padEnd(35)} Mult:${m.padEnd(5)} Stage%:${s.padEnd(5)} VerseEQ:${eq}`,
    );
  });
}
run().catch(console.error);
