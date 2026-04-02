/**
 * CABTAL Gifts Importer
 * Reads output/gifts-cleaned.json (produced by transform-gifts.js) and
 * creates items on the Gifts board via the Monday.com API.
 *
 * Usage:
 *   node import-gifts.js                — import all records (skips duplicates)
 *   node import-gifts.js --dry-run      — show what would be created, no API calls
 *   node import-gifts.js --limit N      — import only first N records (for testing)
 *   node import-gifts.js --delay MS     — ms between API calls (default: 300)
 *
 * Duplicate detection:
 *   Checks the Finance System Intake / Pledged / One Time groups for existing
 *   items whose name + date + amount match, and skips them.
 *
 * Output:
 *   output/import-gifts-results.json    — per-record result log
 */

const fs = require("fs");
const path = require("path");

const { BOARDS, GIFTS_COLS, GIFTS_GROUPS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const IN_FILE = path.join(__dirname, "output", "gifts-cleaned.json");
const OUT_FILE = path.join(__dirname, "output", "import-gifts-results.json");

const T = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity; })();
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const BOARD_ID = String(BOARDS.gifts);
const VALID_GROUP_IDS = new Set(Object.values(GIFTS_GROUPS));

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

function resolveGroupId(rec) {
    if (rec._groupId && VALID_GROUP_IDS.has(rec._groupId)) {
        return rec._groupId;
    }

    const status = String(rec[GIFTS_COLS.status] || "").trim().toLowerCase();
    if (status === "one time gift") return GIFTS_GROUPS.oneTime;
    if (status === "pledged gift" || status === "reoccuring gift") return GIFTS_GROUPS.pledged;
    return GIFTS_GROUPS.financeIntake;
}

// ── Build Monday column_values JSON ──────────────────────────────────────────
function buildColumnValues(rec) {
    const cv = {};

    // Date
    if (rec[GIFTS_COLS.date]) {
        cv[GIFTS_COLS.date] = { date: rec[GIFTS_COLS.date] };
    }

    // Donation Amount
    if (rec[GIFTS_COLS.amount] != null) {
        cv[GIFTS_COLS.amount] = rec[GIFTS_COLS.amount];
    }

    // Status (Pledged Gift / Reoccuring Gift / One Time Gift)
    if (rec[GIFTS_COLS.status]) {
        cv[GIFTS_COLS.status] = { label: rec[GIFTS_COLS.status] };
    }

    return JSON.stringify(cv);
}

// ── Duplicate checker — fetch existing items across all gift groups ────────────
async function fetchExistingGiftKeys() {
    // Key = "name|date|amount" for cheap duplicate detection
    const existing = new Set();
    let cursor = null;

    do {
        const query = cursor
            ? `query($cursor: String!) {
           next_items_page(limit: 200, cursor: $cursor) {
             cursor
             items {
               name
               column_values(ids: ["date4","numbers"]) { id text }
             }
           }
         }`
            : `query($boardId: ID!) {
           boards(ids: [$boardId]) {
             items_page(limit: 200) {
               cursor
               items {
                 name
                 column_values(ids: ["date4","numbers"]) { id text }
               }
             }
           }
         }`;

        const vars = cursor ? { cursor } : { boardId: BOARD_ID };
        const data = await gql(query, vars);
        const page = cursor
            ? data?.next_items_page
            : data?.boards?.[0]?.items_page;

        if (!page) break;
        page.items?.forEach(item => {
            const date = item.column_values?.find(c => c.id === "date4")?.text || "";
            const amount = item.column_values?.find(c => c.id === "numbers")?.text || "";
            existing.add(`${item.name}|${date}|${amount}`);
        });
        cursor = page.cursor || null;
    } while (cursor);

    return existing;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(IN_FILE)) {
        console.error(`Input file not found: ${IN_FILE}`);
        console.error("Run transform-gifts.js first.");
        process.exit(1);
    }

    const records = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
    const toImport = records.slice(0, LIMIT);

    console.log(`\nCABTAL Gifts Importer`);
    console.log(`Board : ${BOARD_ID} — Future of CABTAL RM GIFTS`);
    console.log(`Records to process: ${toImport.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

    let existingKeys = new Set();
    if (!DRY_RUN) {
        console.log(`\nFetching existing gift items for duplicate check…`);
        existingKeys = await fetchExistingGiftKeys();
        console.log(`  Found ${existingKeys.size} existing items.`);
    }

    const results = [];
    let created = 0, skipped = 0, errors = 0;

    for (let i = 0; i < toImport.length; i++) {
        const rec = toImport[i];
        const itemName = rec[GIFTS_COLS.name];
        const groupId = resolveGroupId(rec);

        // Duplicate key check
        const dedupKey = `${itemName}|${rec[GIFTS_COLS.date] || ""}|${rec[GIFTS_COLS.amount] || ""}`;

        if (!DRY_RUN && existingKeys.has(dedupKey)) {
            console.log(`  [${i + 1}/${toImport.length}] SKIP  "${itemName}" (${rec._sheet})`);
            results.push({ status: "skipped", name: itemName, sheet: rec._sheet, rowNum: rec._rowNum });
            skipped++;
            continue;
        }

        const colVals = buildColumnValues(rec);

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${toImport.length}] DRY   "${itemName}" → group ${groupId}`);
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
                {
                    boardId: BOARD_ID,
                    groupId,
                    itemName: itemName,
                    colVals: colVals,
                }
            );
            const newId = data?.create_item?.id;
            console.log(`  [${i + 1}/${toImport.length}] OK    "${itemName}" → id ${newId}`);
            results.push({ status: "created", name: itemName, id: newId, sheet: rec._sheet, rowNum: rec._rowNum });
            existingKeys.add(dedupKey);
            created++;
        } catch (err) {
            console.error(`  [${i + 1}/${toImport.length}] ERROR "${itemName}": ${err.message}`);
            results.push({ status: "error", name: itemName, error: err.message, sheet: rec._sheet, rowNum: rec._rowNum });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    // ── Final summary ─────────────────────────────────────────────────────────
    console.log(`\n── Import Summary ───────────────────────────────────────────`);
    console.log(`  Created : ${created}`);
    console.log(`  Skipped : ${skipped}`);
    console.log(`  Errors  : ${errors}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults logged → ${OUT_FILE}`);
    console.log("\nDone.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
