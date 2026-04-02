/**
 * CABTAL Organizations Importer
 * Reads output/orgs-cleaned.json (produced by transform-orgs.js) and
 * creates items on the Organizations board via the Monday.com API.
 *
 * Usage:
 *   node import-orgs.js                — import all records (skips duplicates)
 *   node import-orgs.js --dry-run      — show what would be created, no API calls
 *   node import-orgs.js --limit N      — import only first N records (for testing)
 *   node import-orgs.js --delay MS     — ms between API calls (default: 300)
 *
 * Duplicate detection:
 *   Checks the Active group for existing items whose name exactly matches.
 *   Re-running is safe.
 *
 * Output:
 *   output/import-orgs-results.json    — per-record result log
 */

const fs = require("fs");
const path = require("path");

const { BOARDS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const IN_FILE    = path.join(__dirname, "output", "orgs-cleaned.json");
const OUT_FILE   = path.join(__dirname, "output", "import-orgs-results.json");

const T        = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");
const LIMIT    = (() => { const i = process.argv.indexOf("--limit"); return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity; })();
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const BOARD_ID        = String(BOARDS.orgs);
const IMPORT_GROUP_ID = "topics"; // Active group

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

// ── Build Monday column_values JSON ──────────────────────────────────────────
function buildColumnValues(rec) {
    const cv = {};

    // Organization Type status (label)
    if (rec["color_mkw9hkdb"]) {
        cv["color_mkw9hkdb"] = { label: rec["color_mkw9hkdb"] };
    }

    // Denomination dropdown (label)
    if (rec["dropdown_mkx5q5ga"]) {
        cv["dropdown_mkx5q5ga"] = rec["dropdown_mkx5q5ga"];
    }

    // ORG Status (Active / Dormant)
    if (rec["color_mkwbw323"]) {
        cv["color_mkwbw323"] = { label: rec["color_mkwbw323"] };
    }

    // Pastor name (text)
    if (rec["text_mkxd4aq0"]) {
        cv["text_mkxd4aq0"] = rec["text_mkxd4aq0"];
    }

    // Pastor phone
    if (rec["phone"]) {
        const digits = String(rec["phone"]).replace(/\D+/g, "");
        const e164 = rec["phone"].startsWith("+") ? rec["phone"] : `+${digits}`;
        cv["phone"] = { phone: e164, countryShortName: "CM" };
    }

    // Last BTS date (stored as Original Contact Date)
    if (rec["date4"]) {
        cv["date4"] = { date: rec["date4"] };
    }

    return JSON.stringify(cv);
}

// ── Duplicate checker — fetch existing item names in Active group ─────────────
async function fetchExistingNames() {
    const existing = new Set();
    let cursor = null;

    do {
        const query = cursor
            ? `query($cursor: String!) {
           next_items_page(limit: 200, cursor: $cursor) {
             cursor
             items { name }
           }
         }`
            : `query($boardId: ID!, $groupId: String!) {
           boards(ids: [$boardId]) {
             groups(ids: [$groupId]) {
               items_page(limit: 200) {
                 cursor
                 items { name }
               }
             }
           }
         }`;

        const vars = cursor
            ? { cursor }
            : { boardId: BOARD_ID, groupId: IMPORT_GROUP_ID };

        const data = await gql(query, vars);
        const page = cursor
            ? data?.next_items_page
            : data?.boards?.[0]?.groups?.[0]?.items_page;

        if (!page) break;
        page.items?.forEach(item => existing.add(item.name));
        cursor = page.cursor || null;
    } while (cursor);

    return existing;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(IN_FILE)) {
        console.error(`Input file not found: ${IN_FILE}`);
        console.error("Run transform-orgs.js first.");
        process.exit(1);
    }

    const records  = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
    const toImport = records.slice(0, LIMIT);

    console.log(`\nCABTAL Organizations Importer`);
    console.log(`Board : ${BOARD_ID} — Future of CABTAL RM Organizations`);
    console.log(`Group : ${IMPORT_GROUP_ID} — Active`);
    console.log(`Records to process: ${toImport.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

    let existingNames = new Set();
    if (!DRY_RUN) {
        console.log(`\nFetching existing items in group for duplicate check…`);
        existingNames = await fetchExistingNames();
        console.log(`  Found ${existingNames.size} existing items.`);
    }

    const results = [];
    let created = 0, skipped = 0, errors = 0;

    for (let i = 0; i < toImport.length; i++) {
        const rec      = toImport[i];
        const itemName = rec["name"];
        const groupId  = rec._groupId || IMPORT_GROUP_ID;

        if (!DRY_RUN && existingNames.has(itemName)) {
            console.log(`  [${i + 1}/${toImport.length}] SKIP  "${itemName}"`);
            results.push({ status: "skipped", name: itemName, rowNum: rec._rowNum });
            skipped++;
            continue;
        }

        const colVals = buildColumnValues(rec);

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${toImport.length}] DRY   "${itemName}" → group ${groupId}`);
            console.log(`         denom=${rec["dropdown_mkx5q5ga"] || "(none)"}  pastor=${rec["text_mkxd4aq0"] || "(none)"}  phone=${rec["phone"] || "(none)"}  lastBTS=${rec["date4"] || "(none)"}`);
            results.push({ status: "dry-run", name: itemName, colVals, groupId, rowNum: rec._rowNum });
            created++;
            continue;
        }

        try {
            const data = await gql(
                `mutation($boardId: ID!, $groupId: String!, $itemName: String!, $colVals: JSON!) {
           create_item(
             board_id: $boardId,
             group_id: $groupId,
             item_name: $itemName,
             column_values: $colVals
           ) { id }
         }`,
                { boardId: BOARD_ID, groupId, itemName, colVals }
            );
            const newId = data?.create_item?.id;
            console.log(`  [${i + 1}/${toImport.length}] OK    "${itemName}" → id ${newId}`);
            results.push({ status: "created", name: itemName, id: newId, rowNum: rec._rowNum });
            existingNames.add(itemName);
            created++;
        } catch (err) {
            console.error(`  [${i + 1}/${toImport.length}] ERROR "${itemName}": ${err.message}`);
            results.push({ status: "error", name: itemName, error: err.message, rowNum: rec._rowNum });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log(`\n── Import Summary ───────────────────────────────────────────`);
    console.log(`  Created : ${created}`);
    console.log(`  Skipped : ${skipped}`);
    console.log(`  Errors  : ${errors}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults logged → ${OUT_FILE}`);
    console.log("\nDone.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
