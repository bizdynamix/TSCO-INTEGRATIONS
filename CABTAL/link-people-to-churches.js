/**
 * CABTAL — Link People Items to Church/Organization Items
 *
 * Matches people items' "Real Church Name" (text_mkztnmd) to organization items
 * on the Organizations board, then sets the board_relation column (board_relation_mkw9r2aa)
 * on each person to create the connection.
 *
 * Usage:
 *   node link-people-to-churches.js                — live link
 *   node link-people-to-churches.js --dry-run      — show matches without writing
 *   node link-people-to-churches.js --delay MS     — ms between API calls (default: 300)
 *
 * Output:
 *   output/link-people-churches-results.json
 */

const fs = require("fs");
const path = require("path");
const { BOARDS, PEOPLE_COLS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(__dirname, "monday-secret.json");
const OUT_FILE   = path.join(__dirname, "output", "link-people-churches-results.json");

const T        = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")).MONDAY_API_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");
const DELAY_MS = (() => { const i = process.argv.indexOf("--delay"); return i !== -1 ? parseInt(process.argv[i + 1]) : 300; })();

const PEOPLE_BOARD = String(BOARDS.people);
const ORGS_BOARD   = String(BOARDS.orgs);
const CHURCH_LINK_COL = "board_relation_mkw9r2aa"; // "Church" board_relation on People board

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

// ── Fetch all org items (paginated) ──────────────────────────────────────────
async function fetchAllOrgs() {
    const orgs = [];
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

        const vars = cursor ? { cursor } : { boardId: ORGS_BOARD };
        const data = await gql(query, vars);
        const page = cursor ? data?.next_items_page : data?.boards?.[0]?.items_page;

        if (!page) break;
        orgs.push(...(page.items || []));
        cursor = page.cursor || null;
    } while (cursor);

    return orgs;
}

// ── Fetch all people items with church name column (paginated) ────────────────
async function fetchAllPeople() {
    const people = [];
    let cursor = null;
    const churchCol = PEOPLE_COLS.churchNameNorm; // text_mkztnmd

    do {
        const query = cursor
            ? `query($cursor: String!) {
                next_items_page(limit: 200, cursor: $cursor) {
                    cursor
                    items {
                        id name
                        column_values(ids: ["${churchCol}"]) { id text }
                    }
                }
            }`
            : `query($boardId: ID!) {
                boards(ids: [$boardId]) {
                    items_page(limit: 200) {
                        cursor
                        items {
                            id name
                            column_values(ids: ["${churchCol}"]) { id text }
                        }
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

// ── Build org name index ─────────────────────────────────────────────────────
function normaliseKey(name) {
    // Collapse all spaces/hyphens to single space, uppercase
    return name.trim().toUpperCase().replace(/[\s\-]+/g, "");
}

function buildOrgIndex(orgs) {
    const byName = new Map(); // normalised name → org item
    for (const org of orgs) {
        byName.set(normaliseKey(org.name), org);
    }
    return byName;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    console.log("\nCABTAL — Link People to Churches");
    console.log(`People board: ${PEOPLE_BOARD}`);
    console.log(`Orgs board  : ${ORGS_BOARD}`);
    console.log(`Link column : ${CHURCH_LINK_COL}`);
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

    // Fetch data
    console.log("Fetching organization items...");
    const orgs = await fetchAllOrgs();
    console.log(`  Found ${orgs.length} org items.`);

    console.log("Fetching people items...");
    const people = await fetchAllPeople();
    console.log(`  Found ${people.length} people items.\n`);

    // Build org index
    const orgIndex = buildOrgIndex(orgs);
    console.log(`Org name index: ${orgIndex.size} entries\n`);

    const results = [];
    let linked = 0, skipped = 0, unmatched = 0, errors = 0;

    for (let i = 0; i < people.length; i++) {
        const person = people[i];
        const churchCol = person.column_values?.find(c => c.id === PEOPLE_COLS.churchNameNorm);
        const churchName = (churchCol?.text || "").trim();

        // Skip empty or event-name churches
        if (!churchName || /^annual report/i.test(churchName)) {
            if (churchName) {
                // Event name — skip silently
                results.push({ status: "skipped-event", personId: person.id, personName: person.name, churchName });
            } else {
                results.push({ status: "skipped-empty", personId: person.id, personName: person.name });
            }
            skipped++;
            continue;
        }

        // Try to match church name to org
        const key = normaliseKey(churchName);
        const match = orgIndex.get(key);

        if (!match) {
            console.log(`  [${i + 1}/${people.length}] UNMATCHED "${person.name}" → church "${churchName}"`);
            results.push({ status: "unmatched", personId: person.id, personName: person.name, churchName });
            unmatched++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [${i + 1}/${people.length}] MATCH "${person.name}" → "${match.name}" (id: ${match.id})`);
            results.push({ status: "dry-match", personId: person.id, personName: person.name, orgId: match.id, orgName: match.name });
            linked++;
            continue;
        }

        try {
            const colVal = JSON.stringify({ [CHURCH_LINK_COL]: { item_ids: [Number(match.id)] } });
            await gql(
                `mutation($boardId: ID!, $itemId: ID!, $colVals: JSON!) {
                    change_multiple_column_values(
                        board_id: $boardId,
                        item_id: $itemId,
                        column_values: $colVals
                    ) { id }
                }`,
                { boardId: PEOPLE_BOARD, itemId: String(person.id), colVals: colVal }
            );
            console.log(`  [${i + 1}/${people.length}] LINKED "${person.name}" → "${match.name}"`);
            results.push({ status: "linked", personId: person.id, personName: person.name, orgId: match.id, orgName: match.name });
            linked++;
        } catch (err) {
            console.error(`  [${i + 1}/${people.length}] ERROR "${person.name}": ${err.message}`);
            results.push({ status: "error", personId: person.id, personName: person.name, error: err.message });
            errors++;
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log(`\n── Link Summary ───────────────────────────────────────────`);
    console.log(`  Linked    : ${linked}`);
    console.log(`  Skipped   : ${skipped} (empty or event names)`);
    console.log(`  Unmatched : ${unmatched}`);
    console.log(`  Errors    : ${errors}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults logged → ${OUT_FILE}`);
    console.log("Done.\n");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
