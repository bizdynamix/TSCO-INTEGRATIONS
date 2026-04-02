/**
 * CABTAL — Create Gift Subitems Under People
 *
 * For each gift record, finds the matching person on the People board
 * and creates a subitem (on the People Subitems board 18400425739)
 * with Gift Amount and Gift Date. This enables the "Total Gift Amount"
 * mirror column on the People board.
 *
 * Usage:
 *   node create-gift-subitems.js                — live create
 *   node create-gift-subitems.js --dry-run      — show matches without writing
 *   node create-gift-subitems.js --delay MS     — ms between API calls (default: 300)
 *
 * Output:
 *   output/create-gift-subitems-results.json
 */

const fs = require("fs");
const path = require("path");
const { BOARDS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const GIFTS_FILE = path.join(__dirname, "output", "gifts-cleaned.json");
const OUT_FILE   = path.join(__dirname, "output", "create-gift-subitems-results.json");

const T        = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const PEOPLE_BOARD = String(BOARDS.people);

// Subitem column IDs (from explore-boards.js output for board 18400425739)
const SUBITEM_AMOUNT_COL = "numeric_mkztz3w7"; // Gift Amount
const SUBITEM_DATE_COL   = "date_mkzt9yjb";    // Gift Date

// ── API helper ────────────────────────────────────────────────────────────────
async function gql(query, vars = {}) {
    const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
            Authorization: T,
            "Content-Type": "application/json",
            "API-Version": "2024-01",
        },
        body: JSON.stringify({ query, variables: vars }),
    });
    const data = await res.json();
    if (data.errors) throw new Error("GQL errors: " + JSON.stringify(data.errors));
    return data.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch all people items (paginated) ────────────────────────────────────────
async function fetchAllPeople() {
    const people = [];
    let cursor = null;

    do {
        const query = cursor
            ? `query($cursor: String!) {
                next_items_page(limit: 200, cursor: $cursor) {
                    cursor
                    items { id name column_values(ids: ["phone3"]) { id text } }
                }
            }`
            : `query($boardId: ID!) {
                boards(ids: [$boardId]) {
                    items_page(limit: 200) {
                        cursor
                        items { id name column_values(ids: ["phone3"]) { id text } }
                    }
                }
            }`;

        const vars = cursor ? { cursor } : { boardId: PEOPLE_BOARD };
        const data = await gql(query, vars);
        const page = cursor ? data?.next_items_page : data?.boards?.[0]?.items_page;

        if (!page) break;
        people.push(...(page.items || []));
        cursor = page.cursor || null;
    } while (cursor);

    return people;
}

// ── Build people matching index ──────────────────────────────────────────────
function buildPeopleIndex(people) {
    const byPhone = new Map();
    const byName  = new Map();

    for (const p of people) {
        const phoneCol = p.column_values?.find(c => c.id === "phone3");
        const phoneText = (phoneCol?.text || "").replace(/\s+/g, "");
        if (phoneText) byPhone.set(phoneText, p);

        const namePart = p.name.split(" | ")[0].trim().toUpperCase();
        if (namePart) byName.set(namePart, p);
    }

    return { byPhone, byName };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(GIFTS_FILE)) {
        console.error(`Input file not found: ${GIFTS_FILE}`);
        console.error("Run transform-gifts.js first.");
        process.exit(1);
    }

    const giftRecords = JSON.parse(fs.readFileSync(GIFTS_FILE, "utf8"));

    console.log("\nCABTAL — Create Gift Subitems Under People");
    console.log(`People board  : ${PEOPLE_BOARD}`);
    console.log(`Subitems board: ${BOARDS.peopleSubitems}`);
    console.log(`Gift records  : ${giftRecords.length}`);
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

    // Fetch people
    console.log("Fetching people items...");
    const people = await fetchAllPeople();
    console.log(`  Found ${people.length} people items.\n`);

    const { byPhone, byName } = buildPeopleIndex(people);
    console.log(`Matching index: ${byPhone.size} phones, ${byName.size} names\n`);

    const results = [];
    let created = 0, unmatched = 0, errors = 0;

    for (let i = 0; i < giftRecords.length; i++) {
        const rec = giftRecords[i];
        const giftName = rec.name || "(unnamed)";
        const giftNameUpper = giftName.trim().toUpperCase();

        // Match to person: phone first, then name
        let match = null;
        let matchMethod = "";

        if (rec._rawPhone) {
            const cleanPhone = String(rec._rawPhone).replace(/\s+/g, "");
            match = byPhone.get(cleanPhone);
            if (match) matchMethod = "phone";
        }

        if (!match) {
            match = byName.get(giftNameUpper);
            if (match) matchMethod = "name";
        }

        if (!match) {
            console.log(`  [${i + 1}/${giftRecords.length}] UNMATCHED "${giftName}"`);
            results.push({ status: "unmatched", giftName, sheet: rec._sheet });
            unmatched++;
            continue;
        }

        // Build subitem column values
        const cv = {};
        if (rec.numbers != null) {
            cv[SUBITEM_AMOUNT_COL] = rec.numbers;
        }
        if (rec.date4) {
            cv[SUBITEM_DATE_COL] = { date: rec.date4 };
        }

        const subitemName = `${giftName} — ${rec._sheet || "Gift"}`;

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${giftRecords.length}] MATCH (${matchMethod}) "${giftName}" → person "${match.name}" | amount=${rec.numbers || "?"} date=${rec.date4 || "?"}`);
            results.push({ status: "dry-match", giftName, personId: match.id, personName: match.name, method: matchMethod, amount: rec.numbers, date: rec.date4 });
            created++;
            continue;
        }

        try {
            const colVals = JSON.stringify(cv);
            const data = await gql(
                `mutation($parentId: ID!, $itemName: String!, $colVals: JSON!) {
                    create_subitem(
                        parent_item_id: $parentId,
                        item_name: $itemName,
                        column_values: $colVals
                    ) { id board { id } }
                }`,
                { parentId: String(match.id), itemName: subitemName, colVals }
            );
            const newId = data?.create_subitem?.id;
            console.log(`  [${i + 1}/${giftRecords.length}] CREATED (${matchMethod}) "${subitemName}" → subitem ${newId} under "${match.name}"`);
            results.push({ status: "created", giftName, subitemId: newId, personId: match.id, personName: match.name, method: matchMethod });
            created++;
        } catch (err) {
            console.error(`  [${i + 1}/${giftRecords.length}] ERROR "${giftName}": ${err.message}`);
            results.push({ status: "error", giftName, error: err.message });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log(`\n── Subitem Summary ────────────────────────────────────────`);
    console.log(`  Created   : ${created}`);
    console.log(`  Unmatched : ${unmatched}`);
    console.log(`  Errors    : ${errors}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults logged → ${OUT_FILE}`);
    console.log("Done.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
