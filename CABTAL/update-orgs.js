/**
 * CABTAL Organizations Updater
 * Reads output/orgs-cleaned.json and PATCHES existing items on the Future Orgs board
 * with pastor name, pastor phone, last BTS date, Organization Type, and ORG Status
 * from the CHURCHES Excel sheet.
 *
 * Strategy: match by item name (exact), then change_multiple_column_values.
 * Items with no name match are logged as unmatched.
 *
 * Usage:
 *   node update-orgs.js --dry-run      — show what would be updated, no API calls
 *   node update-orgs.js                — live update
 *   node update-orgs.js --limit N      — only first N records
 *   node update-orgs.js --delay MS     — ms between API calls (default: 300)
 *
 * Output:
 *   output/update-orgs-results.json
 */

const fs = require("fs");
const path = require("path");

const { BOARDS } = require("./mapping-config");

const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const IN_FILE    = path.join(__dirname, "output", "orgs-cleaned.json");
const OUT_FILE   = path.join(__dirname, "output", "update-orgs-results.json");

const T        = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");
const LIMIT    = (() => { const i = process.argv.indexOf("--limit"); return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity; })();
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const BOARD_ID = String(BOARDS.orgs); // 18400425898

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

// ── Fetch all existing items from the board (name → id map) ──────────────────
async function fetchExistingItems() {
    const map = {}; // name → id
    let cursor = null;

    do {
        const query = cursor
            ? `query($cursor: String!) {
           next_items_page(limit: 200, cursor: $cursor) {
             cursor
             items { id name }
           }
         }`
            : `query($boardId: ID!) {
           boards(ids: [$boardId]) {
             items_page(limit: 200) {
               cursor
               items { id name }
             }
           }
         }`;

        const vars = cursor ? { cursor } : { boardId: BOARD_ID };
        const data = await gql(query, vars);
        const page = cursor ? data?.next_items_page : data?.boards?.[0]?.items_page;
        if (!page) break;
        page.items?.forEach(item => { map[item.name] = item.id; });
        cursor = page.cursor || null;
    } while (cursor);

    return map;
}

// ── Build column_values patch ────────────────────────────────────────────────
function buildPatch(rec) {
    const cv = {};

    // Organization Type: Church
    cv["color_mkw9hkdb"] = { label: "Church" };

    // ORG Status: Active
    cv["color_mkwbw323"] = { label: "Active" };

    // Denomination dropdown
    if (rec["dropdown_mkx5q5ga"]) {
        cv["dropdown_mkx5q5ga"] = rec["dropdown_mkx5q5ga"];
    }

    // Pastor name
    if (rec["text_mkxd4aq0"]) {
        cv["text_mkxd4aq0"] = rec["text_mkxd4aq0"];
    }

    // Pastor phone
    if (rec["phone"]) {
        const digits = String(rec["phone"]).replace(/\D+/g, "");
        const e164 = String(rec["phone"]).startsWith("+") ? rec["phone"] : "+" + digits;
        cv["phone"] = { phone: e164, countryShortName: "CM" };
    }

    // Last BTS date (stored as Original Contact Date)
    if (rec["date4"]) {
        cv["date4"] = { date: rec["date4"] };
    }

    return JSON.stringify(cv);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(IN_FILE)) {
        console.error("Input file not found: " + IN_FILE);
        console.error("Run transform-orgs.js first.");
        process.exit(1);
    }

    const records  = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
    const toUpdate = records.slice(0, LIMIT);

    console.log("\nCABTAL Organizations Updater");
    console.log("Board : " + BOARD_ID + " — Future of CABTAL RM Organizations");
    console.log("Records to process: " + toUpdate.length + (DRY_RUN ? " (DRY RUN)" : ""));

    // Fetch existing items for name matching
    let existingMap = {};
    if (!DRY_RUN) {
        console.log("\nFetching existing items for name matching...");
        existingMap = await fetchExistingItems();
        console.log("  Found " + Object.keys(existingMap).length + " existing items.");
    }

    const results = [];
    let updated = 0, unmatched = 0, errors = 0;

    for (let i = 0; i < toUpdate.length; i++) {
        const rec      = toUpdate[i];
        const itemName = rec["name"];
        const patch    = buildPatch(rec);

        if (DRY_RUN) {
            const p = JSON.parse(patch);
            const parts = [
                "orgType=" + (p["color_mkw9hkdb"] ? p["color_mkw9hkdb"].label : "(none)"),
                "status=" + (p["color_mkwbw323"] ? p["color_mkwbw323"].label : "(none)"),
                "denom=" + (rec["dropdown_mkx5q5ga"] || "(none)"),
                "pastor=" + (rec["text_mkxd4aq0"] || "(none)"),
                "phone=" + (rec["phone"] || "(none)"),
                "lastBTS=" + (rec["date4"] || "(none)"),
            ].join("  ");
            console.log("  [" + (i+1) + "/" + toUpdate.length + "] DRY   \"" + itemName + "\"");
            console.log("         " + parts);
            results.push({ status: "dry-run", name: itemName, patch, rowNum: rec._rowNum });
            updated++;
            continue;
        }

        const itemId = existingMap[itemName];
        if (!itemId) {
            console.log("  [" + (i+1) + "/" + toUpdate.length + "] NO MATCH  \"" + itemName + "\"");
            results.push({ status: "unmatched", name: itemName, rowNum: rec._rowNum });
            unmatched++;
            continue;
        }

        try {
            await gql(
                `mutation($boardId: ID!, $itemId: ID!, $colVals: JSON!) {
           change_multiple_column_values(
             board_id: $boardId,
             item_id: $itemId,
             column_values: $colVals
           ) { id }
         }`,
                { boardId: BOARD_ID, itemId, colVals: patch }
            );
            console.log("  [" + (i+1) + "/" + toUpdate.length + "] OK    \"" + itemName + "\" (id " + itemId + ")");
            results.push({ status: "updated", name: itemName, id: itemId, rowNum: rec._rowNum });
            updated++;
        } catch (err) {
            console.error("  [" + (i+1) + "/" + toUpdate.length + "] ERROR \"" + itemName + "\": " + err.message);
            results.push({ status: "error", name: itemName, error: err.message, rowNum: rec._rowNum });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log("\n── Update Summary ───────────────────────────────────────────");
    console.log("  Updated   : " + updated);
    console.log("  Unmatched : " + unmatched);
    console.log("  Errors    : " + errors);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log("\nResults logged -> " + OUT_FILE);
    console.log("\nDone.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
