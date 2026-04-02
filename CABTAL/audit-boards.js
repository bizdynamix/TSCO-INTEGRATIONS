/**
 * Audit all Future CABTAL boards — show gaps and what needs patching.
 */
const fs = require("fs");
const T = JSON.parse(fs.readFileSync("monday-secret.json", "utf8")).MONDAY_API_TOKEN;

async function gql(query, vars = {}) {
    const r = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { Authorization: T, "Content-Type": "application/json", "API-Version": "2024-01" },
        body: JSON.stringify({ query, variables: vars }),
    });
    const d = await r.json();
    if (d.errors) console.error(JSON.stringify(d.errors));
    return d.data;
}

async function fetchAllItems(boardId, colIds) {
    const items = [];
    let cursor = null;
    const colStr = colIds.map(c => '"' + c + '"').join(",");
    do {
        const query = cursor
            ? `query($cursor: String!) { next_items_page(limit:200,cursor:$cursor) { cursor items { id name group{title} column_values(ids:[${colStr}]){ id text } } } }`
            : `query($b: ID!) { boards(ids:[$b]) { items_page(limit:200) { cursor items { id name group{title} column_values(ids:[${colStr}]){ id text } } } } }`;
        const vars = cursor ? { cursor } : { b: String(boardId) };
        const data = await gql(query, vars);
        const page = cursor ? data.next_items_page : data.boards[0].items_page;
        if (!page) break;
        items.push(...page.items);
        cursor = page.cursor || null;
    } while (cursor);
    return items;
}

function val(item, colId) {
    return (item.column_values.find(c => c.id === colId) || {}).text || "";
}

async function run() {
    // ── Orgs board ────────────────────────────────────────────────────────────
    console.log("\n=== Future Orgs Board (18400425898) ===");
    const orgs = await fetchAllItems(18400425898, [
        "color_mkw9hkdb", "color_mkwbw323", "dropdown_mkx5q5ga",
        "text_mkxd4aq0", "phone", "date4"
    ]);
    console.log("Total items: " + orgs.length);
    const orgsMissingType   = orgs.filter(i => !val(i, "color_mkw9hkdb"));
    const orgsMissingStatus = orgs.filter(i => !val(i, "color_mkwbw323"));
    const orgsMissingPastor = orgs.filter(i => !val(i, "text_mkxd4aq0"));
    const orgsMissingPhone  = orgs.filter(i => !val(i, "phone"));
    console.log("  Missing orgType:  " + orgsMissingType.length + " -> " + orgsMissingType.map(i => i.name).join(", "));
    console.log("  Missing status:   " + orgsMissingStatus.length + " -> " + orgsMissingStatus.map(i => i.name).join(", "));
    console.log("  Missing pastor:   " + orgsMissingPastor.length + " -> " + orgsMissingPastor.map(i => i.name).join(", "));
    console.log("  Missing phone:    " + orgsMissingPhone.length + " -> " + orgsMissingPhone.map(i => i.name).join(", "));

    // ── People board ──────────────────────────────────────────────────────────
    console.log("\n=== Future People Board (18400425732) — DCSE_CRM_RM_DATABASE group ===");
    const people = await fetchAllItems(18400425732, [
        "text7", "dup__of_first_name", "phone3", "email",
        "text_mkzt1rkb", "text_mkztnmd", "status_1",
        "dropdown_mkzt91c4", "date4"
    ]);
    // Filter to import group only
    const importGroup = people.filter(i => i.group.title === "DCSE_CRM_RM_DATABASE");
    console.log("Total in DCSE_CRM_RM_DATABASE group: " + importGroup.length);
    const missingPhone      = importGroup.filter(i => !val(i, "phone3"));
    const missingChurchRaw  = importGroup.filter(i => !val(i, "text_mkzt1rkb"));
    const missingChurchNorm = importGroup.filter(i => !val(i, "text_mkztnmd"));
    const missingResource   = importGroup.filter(i => !val(i, "dropdown_mkzt91c4"));
    const missingDate       = importGroup.filter(i => !val(i, "date4"));
    console.log("  Missing phone:       " + missingPhone.length);
    console.log("  Missing church raw:  " + missingChurchRaw.length);
    console.log("  Missing church norm: " + missingChurchNorm.length);
    console.log("  Missing resource:    " + missingResource.length);
    console.log("  Missing date:        " + missingDate.length);
    if (missingPhone.length) console.log("    No phone: " + missingPhone.map(i => i.name).join(", "));
    if (missingResource.length) console.log("    No resource type: " + missingResource.slice(0, 10).map(i => i.name).join(", ") + (missingResource.length > 10 ? "..." : ""));

    // ── Gifts board ───────────────────────────────────────────────────────────
    console.log("\n=== Future Gifts Board (18400426079) ===");
    const gifts = await fetchAllItems(18400426079, ["date4", "numbers", "status__1"]);
    console.log("Total items: " + gifts.length);
    const giftsByGroup = {};
    gifts.forEach(i => {
        giftsByGroup[i.group.title] = (giftsByGroup[i.group.title] || 0) + 1;
    });
    Object.entries(giftsByGroup).forEach(([g, n]) => console.log("  " + g + ": " + n));
    const giftsMissingAmt    = gifts.filter(i => !val(i, "numbers"));
    const giftsMissingDate   = gifts.filter(i => !val(i, "date4"));
    const giftsMissingStatus = gifts.filter(i => !val(i, "status__1"));
    console.log("  Missing amount: " + giftsMissingAmt.length + (giftsMissingAmt.length ? " -> " + giftsMissingAmt.map(i => i.name).join(", ") : ""));
    console.log("  Missing date:   " + giftsMissingDate.length);
    console.log("  Missing status: " + giftsMissingStatus.length + (giftsMissingStatus.length ? " -> " + giftsMissingStatus.map(i => i.name).join(", ") : ""));
}

run().catch(console.error);
