/**
 * CABTAL — Link Gift Items to People Items
 *
 * Matches gift items on the Gifts board to people items on the People board
 * using phone number (primary) and name (fallback), then sets the board_relation
 * column on each gift to create the connection.
 *
 * Usage:
 *   node link-gifts-to-people.js                — live link
 *   node link-gifts-to-people.js --dry-run      — show matches without writing
 *   node link-gifts-to-people.js --delay MS     — ms between API calls (default: 300)
 *
 * Prerequisites:
 *   - A board_relation column must exist on the Gifts board pointing to the People board.
 *     The script auto-detects it. If none is found, it will exit with instructions.
 *
 * Output:
 *   output/link-gifts-results.json
 */

const fs = require("fs");
const path = require("path");
const { BOARDS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const GIFTS_FILE = path.join(__dirname, "output", "gifts-cleaned.json");
const OUT_FILE   = path.join(__dirname, "output", "link-gifts-results.json");

const T        = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const PEOPLE_BOARD = String(BOARDS.people);
const GIFTS_BOARD  = String(BOARDS.gifts);

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

// ── Auto-detect board_relation column on Gifts board ─────────────────────────
async function findDonorLinkColumn() {
    const data = await gql(`{
        boards(ids: [${GIFTS_BOARD}]) {
            columns { id title type settings_str }
        }
    }`);
    const cols = data.boards[0].columns;
    const relCols = cols.filter(c => c.type === "board_relation");

    // Find one that points to the People board
    for (const col of relCols) {
        const settings = JSON.parse(col.settings_str || "{}");
        const boardIds = settings.boardIds || [];
        if (boardIds.includes(Number(PEOPLE_BOARD)) || boardIds.includes(PEOPLE_BOARD)) {
            return col.id;
        }
    }

    // If no exact match, return the first board_relation column (user may have just created it)
    if (relCols.length === 1) {
        console.log(`  Note: Using board_relation column "${relCols[0].title}" (${relCols[0].id})`);
        return relCols[0].id;
    }

    return null;
}

// ── Fetch all people items (paginated) ────────────────────────────────────────
async function fetchAllPeople() {
    const people = [];
    let cursor = null;

    do {
        const query = cursor
            ? `query($cursor: String!) {
                next_items_page(limit: 200, cursor: $cursor) {
                    cursor
                    items { id name column_values(ids: ["phone3"]) { id text value } }
                }
            }`
            : `query($boardId: ID!) {
                boards(ids: [$boardId]) {
                    items_page(limit: 200) {
                        cursor
                        items { id name column_values(ids: ["phone3"]) { id text value } }
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

// ── Fetch all gift items (paginated) ──────────────────────────────────────────
async function fetchAllGifts() {
    const gifts = [];
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

        const vars = cursor ? { cursor } : { boardId: GIFTS_BOARD };
        const data = await gql(query, vars);
        const page = cursor ? data?.next_items_page : data?.boards?.[0]?.items_page;

        if (!page) break;
        gifts.push(...(page.items || []));
        cursor = page.cursor || null;
    } while (cursor);

    return gifts;
}

// ── Build matching indexes ───────────────────────────────────────────────────
function buildPeopleIndex(people) {
    const byPhone = new Map();  // phone → person item
    const byName  = new Map();  // normalised name → person item

    for (const p of people) {
        // Phone index
        const phoneCol = p.column_values?.find(c => c.id === "phone3");
        const phoneText = phoneCol?.text || "";
        if (phoneText) {
            byPhone.set(phoneText.replace(/\s+/g, ""), p);
        }

        // Name index — extract name part before " | "
        const namePart = p.name.split(" | ")[0].trim().toUpperCase();
        if (namePart) {
            byName.set(namePart, p);
        }
    }

    return { byPhone, byName };
}

// ── Load gift source data for phone matching ─────────────────────────────────
function loadGiftSourceData() {
    if (!fs.existsSync(GIFTS_FILE)) return new Map();
    const records = JSON.parse(fs.readFileSync(GIFTS_FILE, "utf8"));
    const byName = new Map();
    for (const rec of records) {
        const name = String(rec.name || "").trim().toUpperCase();
        if (name && rec._rawPhone) {
            byName.set(name, rec._rawPhone);
        }
    }
    return byName;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    console.log("\nCABTAL — Link Gifts to People");
    console.log(`Gifts board : ${GIFTS_BOARD}`);
    console.log(`People board: ${PEOPLE_BOARD}`);
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

    // Auto-detect the board_relation column
    const linkColId = await findDonorLinkColumn();
    if (!linkColId) {
        console.error("ERROR: No board_relation column found on the Gifts board.");
        console.error("Please create a 'Connect Boards' column in Monday.com UI:");
        console.error("  1. Go to Future of CABTAL RM GIFTS board");
        console.error("  2. Add column → Connect Boards → select 'Future CABTAL RM People (Donors)'");
        console.error("  3. Re-run this script.");
        process.exit(1);
    }
    console.log(`Board relation column: "${linkColId}"\n`);

    // Fetch data
    console.log("Fetching people items...");
    const people = await fetchAllPeople();
    console.log(`  Found ${people.length} people items.`);

    console.log("Fetching gift items...");
    const gifts = await fetchAllGifts();
    console.log(`  Found ${gifts.length} gift items.`);

    // Build indexes
    const { byPhone, byName } = buildPeopleIndex(people);
    const giftPhones = loadGiftSourceData();

    console.log(`\nMatching index: ${byPhone.size} phones, ${byName.size} names`);
    console.log(`Gift source phones: ${giftPhones.size}\n`);

    const results = [];
    let linked = 0, unmatched = 0, errors = 0;

    for (let i = 0; i < gifts.length; i++) {
        const gift = gifts[i];
        const giftNameUpper = gift.name.trim().toUpperCase();

        // Try phone match first (via source data)
        let match = null;
        let matchMethod = "";
        const phone = giftPhones.get(giftNameUpper);
        if (phone) {
            const cleanPhone = String(phone).replace(/\s+/g, "");
            match = byPhone.get(cleanPhone);
            if (match) matchMethod = "phone";
        }

        // Fallback: name match
        if (!match) {
            match = byName.get(giftNameUpper);
            if (match) matchMethod = "name";
        }

        if (!match) {
            console.log(`  [${i + 1}/${gifts.length}] UNMATCHED "${gift.name}"`);
            results.push({ status: "unmatched", giftId: gift.id, giftName: gift.name });
            unmatched++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${gifts.length}] MATCH (${matchMethod}) "${gift.name}" → "${match.name}" (id: ${match.id})`);
            results.push({ status: "dry-match", giftId: gift.id, giftName: gift.name, personId: match.id, personName: match.name, method: matchMethod });
            linked++;
            continue;
        }

        try {
            const colVal = JSON.stringify({ [linkColId]: { item_ids: [Number(match.id)] } });
            await gql(
                `mutation($boardId: ID!, $itemId: ID!, $colVals: JSON!) {
                    change_multiple_column_values(
                        board_id: $boardId,
                        item_id: $itemId,
                        column_values: $colVals
                    ) { id }
                }`,
                { boardId: GIFTS_BOARD, itemId: String(gift.id), colVals: colVal }
            );
            console.log(`  [${i + 1}/${gifts.length}] LINKED (${matchMethod}) "${gift.name}" → "${match.name}"`);
            results.push({ status: "linked", giftId: gift.id, giftName: gift.name, personId: match.id, personName: match.name, method: matchMethod });
            linked++;
        } catch (err) {
            console.error(`  [${i + 1}/${gifts.length}] ERROR "${gift.name}": ${err.message}`);
            results.push({ status: "error", giftId: gift.id, giftName: gift.name, error: err.message });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log(`\n── Link Summary ───────────────────────────────────────────`);
    console.log(`  Linked    : ${linked}`);
    console.log(`  Unmatched : ${unmatched}`);
    console.log(`  Errors    : ${errors}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults logged → ${OUT_FILE}`);
    console.log("Done.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
