/**
 * Deletes all items in the DCSE_CRM_RM_DATABASE group on the People board.
 * Run this before re-importing to avoid duplicates from an interrupted run.
 */
const fs   = require("fs");
const path = require("path");

const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const BOARD_ID   = "18400425732";
const GROUP_ID   = "group_mkwyx3kv"; // DCSE_CRM_RM_DATABASE

async function gql(token, query, variables = {}) {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;

  // Collect all item IDs across pages
  const ids = [];
  let cursor = null;

  do {
    const data = await gql(token,
      cursor
        ? `query($cursor: String!) { next_items_page(limit: 200, cursor: $cursor) { cursor items { id name } } }`
        : `query($b: ID!, $g: String!) { boards(ids: [$b]) { groups(ids: [$g]) { items_page(limit: 200) { cursor items { id name } } } } }`,
      cursor ? { cursor } : { b: BOARD_ID, g: GROUP_ID }
    );

    const page = cursor
      ? data?.next_items_page
      : data?.boards?.[0]?.groups?.[0]?.items_page;

    if (!page) break;
    page.items.forEach(item => ids.push({ id: item.id, name: item.name }));
    cursor = page.cursor || null;
  } while (cursor);

  console.log(`Found ${ids.length} items to delete in group "${GROUP_ID}".`);
  if (ids.length === 0) { console.log("Nothing to do."); return; }

  let deleted = 0, errors = 0;
  for (let i = 0; i < ids.length; i++) {
    const { id, name } = ids[i];
    try {
      await gql(token,
        `mutation($id: ID!) { delete_item(item_id: $id) { id } }`,
        { id }
      );
      console.log(`  [${i+1}/${ids.length}] DELETED  "${name}"`);
      deleted++;
    } catch (err) {
      console.error(`  [${i+1}/${ids.length}] ERROR    "${name}": ${err.message}`);
      errors++;
    }
    await sleep(150);
  }

  console.log(`\nDone. Deleted: ${deleted}  Errors: ${errors}`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
