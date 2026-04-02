/**
 * CABTAL People Importer
 * Reads output/people-cleaned.json (produced by transform-people.js) and
 * creates items on the People board via the Monday.com API.
 *
 * Usage:
 *   node import-people.js                — import all records (skips duplicates)
 *   node import-people.js --dry-run      — show what would be created, no API calls
 *   node import-people.js --limit N      — import only first N records (for testing)
 *   node import-people.js --delay MS     — ms between API calls (default: 300)
 *
 * Duplicate detection:
 *   Before creating, searches the board for an item whose name exactly matches.
 *   If found, logs "SKIP" and continues. Re-running is safe.
 *
 * Output:
 *   output/import-people-results.json    — per-record result log
 */

const fs = require("fs");
const path = require("path");

const { BOARDS, PEOPLE_COLS, PEOPLE_IMPORT_GROUP } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const IN_FILE = path.join(__dirname, "output", "people-cleaned.json");
const OUT_FILE = path.join(__dirname, "output", "import-people-results.json");

const T = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity; })();
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const BOARD_ID = String(BOARDS.people);

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
    if (data.errors) {
        throw new Error("GQL errors: " + JSON.stringify(data.errors));
    }
    return data.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toSafePhone(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const digits = raw.replace(/\D+/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    if (raw.startsWith("+")) return `+${digits}`;
    return `+${digits}`;
}

// ── Build Monday column_values JSON ──────────────────────────────────────────
function buildColumnValues(rec) {
    const cv = {};

    // Text fields
    if (rec[PEOPLE_COLS.firstName]) cv[PEOPLE_COLS.firstName] = rec[PEOPLE_COLS.firstName];
    if (rec[PEOPLE_COLS.lastName]) cv[PEOPLE_COLS.lastName] = rec[PEOPLE_COLS.lastName];
    if (rec[PEOPLE_COLS.middleName]) cv[PEOPLE_COLS.middleName] = rec[PEOPLE_COLS.middleName];
    if (rec[PEOPLE_COLS.email]) cv[PEOPLE_COLS.email] = { email: rec[PEOPLE_COLS.email], text: rec[PEOPLE_COLS.email] };
    if (rec[PEOPLE_COLS.churchNameRaw]) cv[PEOPLE_COLS.churchNameRaw] = rec[PEOPLE_COLS.churchNameRaw];
    if (rec[PEOPLE_COLS.churchNameNorm]) cv[PEOPLE_COLS.churchNameNorm] = rec[PEOPLE_COLS.churchNameNorm];
    if (rec[PEOPLE_COLS.partnerType]) cv[PEOPLE_COLS.partnerType] = { label: rec[PEOPLE_COLS.partnerType] };

    // Phone (WhatsApp)
    if (rec[PEOPLE_COLS.whatsApp]) {
        const safePhone = toSafePhone(rec[PEOPLE_COLS.whatsApp]);
        if (safePhone) {
            cv[PEOPLE_COLS.whatsApp] = {
                phone: safePhone,
                countryShortName: "CM", // Cameroon default
            };
        }
    }

    // Location column is excluded for now because city-only values are rejected by API.
    // Keep city data in source files and backfill later with full geocodable addresses.

    // Resource Type dropdown (label)
    if (rec[PEOPLE_COLS.resourceType]) {
        cv[PEOPLE_COLS.resourceType] = rec[PEOPLE_COLS.resourceType];
    }

    // Date (first contact)
    if (rec[PEOPLE_COLS.firstContactDate]) {
        cv[PEOPLE_COLS.firstContactDate] = { date: rec[PEOPLE_COLS.firstContactDate] };
    }

    return JSON.stringify(cv);
}

// ── Duplicate checker — fetch existing item names in import group ─────────────
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
            : { boardId: BOARD_ID, groupId: PEOPLE_IMPORT_GROUP };

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
        console.error("Run transform-people.js first.");
        process.exit(1);
    }

    const records = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
    const toImport = records.slice(0, LIMIT);

    console.log(`\nCABTAL People Importer`);
    console.log(`Board : ${BOARD_ID} — Future CABTAL RM People (Donors)`);
    console.log(`Group : ${PEOPLE_IMPORT_GROUP} — DCSE_CRM_RM_DATABASE`);
    console.log(`Records to process: ${toImport.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

    // Load existing names to avoid duplicates
    let existingNames = new Set();
    if (!DRY_RUN) {
        console.log(`\nFetching existing items in group for duplicate check…`);
        existingNames = await fetchExistingNames();
        console.log(`  Found ${existingNames.size} existing items.`);
    }

    const results = [];
    let created = 0, skipped = 0, errors = 0;

    for (let i = 0; i < toImport.length; i++) {
        const rec = toImport[i];
        const itemName = rec[PEOPLE_COLS.name];

        if (!DRY_RUN && existingNames.has(itemName)) {
            console.log(`  [${i + 1}/${toImport.length}] SKIP  "${itemName}"`);
            results.push({ status: "skipped", name: itemName, rowNum: rec._rowNum });
            skipped++;
            continue;
        }

        const colVals = buildColumnValues(rec);

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${toImport.length}] DRY   "${itemName}"`);
            results.push({ status: "dry-run", name: itemName, colVals, rowNum: rec._rowNum });
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
                    groupId: PEOPLE_IMPORT_GROUP,
                    itemName: itemName,
                    colVals: colVals,
                }
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
