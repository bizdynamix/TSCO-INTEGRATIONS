/**
 * import-reports.js
 * For each quarterly report from ERA API:
 *   - If item already exists on board (matched by LanguageISO): upload files + testimonials to quarter columns
 *   - If no match: create a new item, then upload files + testimonials
 *
 * Usage:
 *   node import-reports.js --dry-run   (no writes, logs what would happen)
 *   node import-reports.js             (live)
 *
 * Reads:  output/reports-raw.json  (run fetch-reports.js first)
 * Writes: output/import-results.json
 */

import { readFileSync, writeFileSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const { MONDAY_API_TOKEN } = JSON.parse(readFileSync("./monday-secret.json", "utf8"));

const BOARD_ID       = "18242424286";
const GROUP_ID       = "group_mkwxwgj1";
const QUARTER_LABEL  = "Q1 2026";          // Update each quarter — used in all column title lookups
const ISO_COL_ID     = "text_mkwjbhwm";   // Language ISO/EthCode — used for matching
const ROLV_COL_ID    = "text_mkwmdbe1";   // ROD/ROLV
const SOURCE_COL_ID  = "text_mkwmq1bz";   // Data Source
const PULLED_COL_ID  = "text_mkwy5k28";   // Date pulled

const DRY_RUN  = process.argv.includes("--dry-run");
const DELAY_MS = 500;

if (DRY_RUN) console.log("DRY RUN MODE — no writes will occur\n");

// ── Monday.com helpers ────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
    const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
            Authorization: MONDAY_API_TOKEN,
            "Content-Type": "application/json",
            "API-Version": "2024-01",
        },
        body: JSON.stringify({ query, variables }),
    });
    const data = await res.json();
    if (data.errors) throw new Error("GQL error: " + JSON.stringify(data.errors));
    return data.data;
}

function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// ── Fetch all board items, return maps for matching ───────────────────────────
// Returns { byRolv: { rolv → id }, byName: { "Name (iso)" → id } }
// ROLV is the primary key (unique per dialect); name is the fallback.
// ISO alone is NOT used — many languages share the same ISO code.

async function fetchItemMaps() {
    const items = [];
    let cursor = null;

    do {
        let data;
        if (cursor) {
            data = await gql(
                `query($cursor: String!) {
                    next_items_page(limit: 100, cursor: $cursor) {
                        cursor
                        items { id name column_values(ids: ["${ROLV_COL_ID}"]) { text } }
                    }
                }`,
                { cursor }
            );
            const page = data?.next_items_page;
            if (!page) break;
            items.push(...page.items);
            cursor = page.cursor;
        } else {
            data = await gql(
                `query($boardId: ID!) {
                    boards(ids: [$boardId]) {
                        items_page(limit: 100) {
                            cursor
                            items { id name column_values(ids: ["${ROLV_COL_ID}"]) { text } }
                        }
                    }
                }`,
                { boardId: BOARD_ID }
            );
            const page = data?.boards?.[0]?.items_page;
            if (!page) break;
            items.push(...page.items);
            cursor = page.cursor;
        }
    } while (cursor);

    const byRolv = {};
    const byName = {};
    for (const item of items) {
        const rolv = item.column_values?.[0]?.text?.trim();
        if (rolv) byRolv[rolv] = item.id;
        byName[item.name.trim()] = item.id;
    }
    return { byRolv, byName };
}

// ── Create a new board item ───────────────────────────────────────────────────

async function createItem(langName, iso, rolv) {
    const colVals = JSON.stringify({
        [ISO_COL_ID]:    iso,
        [ROLV_COL_ID]:   rolv ?? "",
        [SOURCE_COL_ID]: "API",
    });
    const data = await gql(
        `mutation($boardId: ID!, $groupId: String!, $itemName: String!, $colVals: JSON!) {
            create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $colVals) { id }
        }`,
        { boardId: BOARD_ID, groupId: GROUP_ID, itemName: `${langName} (${iso})`, colVals }
    );
    return data?.create_item?.id;
}

// ── Create a new column on the board ─────────────────────────────────────────

async function createColumn(title) {
    const data = await gql(
        `mutation($boardId: ID!, $title: String!) {
            create_column(board_id: $boardId, title: $title, column_type: long_text) { id }
        }`,
        { boardId: BOARD_ID, title }
    );
    return data?.create_column?.id;
}

// ── Update long_text columns on an existing item ──────────────────────────────

async function updateTestimonials(itemId, t1ColId, t2ColId, t1, t2) {
    const colVals = {};
    if (t1 && t1ColId) colVals[t1ColId] = { text: t1 };
    if (t2 && t2ColId) colVals[t2ColId] = { text: t2 };
    if (Object.keys(colVals).length === 0) return;
    await gql(
        `mutation($boardId: ID!, $itemId: ID!, $colVals: JSON!) {
            change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $colVals) { id }
        }`,
        { boardId: BOARD_ID, itemId, colVals: JSON.stringify(colVals) }
    );
}

// ── Upload a file from URL to a Monday.com file column ────────────────────────

async function uploadFileToColumn(itemId, columnId, fileUrl, fileName) {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Failed to download ${fileUrl}: ${fileRes.status}`);
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    const query = `mutation ($file: File!) {
        add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id }
    }`;

    const form = new FormData();
    form.append("query", query);
    form.append("variables[file]", new Blob([fileBuffer]), fileName);

    const res = await fetch("https://api.monday.com/v2/file", {
        method: "POST",
        headers: { Authorization: MONDAY_API_TOKEN },
        body: form,
    });

    const json = await res.json();
    if (json.errors) throw new Error("Upload error: " + JSON.stringify(json.errors));
    return json.data?.add_file_to_column?.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const reports = JSON.parse(readFileSync("./output/reports-raw.json", "utf8"));
console.log(`Loaded ${reports.length} reports from output/reports-raw.json\n`);

// Resolve quarter column IDs by title (safe against ID changes)
const boardData = await gql(`query { boards(ids: [${BOARD_ID}]) { columns { id title } } }`);
const columns   = boardData?.boards?.[0]?.columns ?? [];
const finCol    = columns.find((c) => c.title === `FIN ${QUARTER_LABEL}`);
const narCol    = columns.find((c) => c.title === `NAR ${QUARTER_LABEL}`);

if (!finCol) throw new Error(`FIN ${QUARTER_LABEL} column not found on board.`);
if (!narCol) throw new Error(`NAR ${QUARTER_LABEL} column not found on board.`);

// Resolve or create testimonial columns
let t1Col = columns.find((c) => c.title === `Testimonial 1 ${QUARTER_LABEL}`);
let t2Col = columns.find((c) => c.title === `Testimonial 2 ${QUARTER_LABEL}`);

if (!t1Col) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create column: Testimonial 1 ${QUARTER_LABEL}`);
    } else {
        console.log(`  Creating column: Testimonial 1 ${QUARTER_LABEL}...`);
        const id = await createColumn(`Testimonial 1 ${QUARTER_LABEL}`);
        t1Col = { id, title: `Testimonial 1 ${QUARTER_LABEL}` };
        console.log(`  → created column ${id}`);
        await delay(DELAY_MS);
    }
}
if (!t2Col) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create column: Testimonial 2 ${QUARTER_LABEL}`);
    } else {
        console.log(`  Creating column: Testimonial 2 ${QUARTER_LABEL}...`);
        const id = await createColumn(`Testimonial 2 ${QUARTER_LABEL}`);
        t2Col = { id, title: `Testimonial 2 ${QUARTER_LABEL}` };
        console.log(`  → created column ${id}`);
        await delay(DELAY_MS);
    }
}

console.log(`Columns: FIN ${QUARTER_LABEL} → ${finCol.id}  |  NAR ${QUARTER_LABEL} → ${narCol.id}  |  T1 → ${t1Col?.id ?? "pending"}  |  T2 → ${t2Col?.id ?? "pending"}\n`);

// Fetch existing items
console.log("Fetching board items...");
const { byRolv, byName } = await fetchItemMaps();
console.log(`  → ${Object.keys(byRolv).length} items mapped by ROLV, ${Object.keys(byName).length} by name\n`);

const results = [];
let countMatched = 0, countNew = 0, countUploaded = 0, countTestimonials = 0, countErrors = 0;

for (const report of reports) {
    const iso      = report.LanguageISO?.trim();
    const langName = report.LanguageName ?? iso;
    const rolv     = report.LanguageROLV ?? null;
    const excelUrl = report.PNPExcel ?? null;
    const pdfUrl   = report.PNPPDF   ?? null;
    const t1       = report.Testimonials?.[0]?.[0] ?? null;
    const t2       = report.Testimonials?.[0]?.[1] ?? null;

    // Match by ROLV first (unique per dialect), fall back to item name
    const itemName = `${langName} (${iso})`;
    let itemId = (rolv && byRolv[rolv]) || byName[itemName];
    const result = { iso, langName, status: "ok", isNew: false, fin: null, nar: null, testimonials: null };

    // ── Create item if not on board ──────────────────────────────────────────
    if (!itemId) {
        result.isNew = true;
        countNew++;

        if (DRY_RUN) {
            console.log(`  [NEW]    ${langName} (${iso}) — would create item`);
        } else {
            console.log(`  [CREATE] ${langName} (${iso})`);
            try {
                itemId = await createItem(langName, iso, rolv);
                if (rolv) byRolv[rolv] = itemId; // prevent duplicates
                byName[itemName] = itemId;
                console.log(`           → created item ${itemId}`);
                await delay(DELAY_MS);
            } catch (err) {
                console.error(`           ✗ Create failed: ${err.message}`);
                result.status = "error";
                result.error  = err.message;
                results.push(result);
                countErrors++;
                continue;
            }
        }
    } else {
        countMatched++;
    }

    result.itemId = itemId;

    // ── Upload files ─────────────────────────────────────────────────────────
    const tag = DRY_RUN ? "DRY RUN" : "UPLOAD";

    if (!excelUrl && !pdfUrl) {
        console.log(`  [${tag}]  ${langName} (${iso}) — no files`);
        result.status = "no_files";
        results.push(result);
        continue;
    }

    if (!DRY_RUN) console.log(`  [UPLOAD] ${langName} (${iso}) — item ${itemId}`);

    if (DRY_RUN) {
        if (excelUrl) {
            const fileName = excelUrl.split("/").pop();
            console.log(`           FIN ${QUARTER_LABEL} ← ${fileName}`);
            result.fin = { dryRun: true, url: excelUrl, fileName };
        }
        if (pdfUrl) {
            const fileName = pdfUrl.split("/").pop();
            console.log(`           NAR ${QUARTER_LABEL} ← ${fileName}`);
            result.nar = { dryRun: true, url: pdfUrl, fileName };
        }
        if (t1) console.log(`           T1 ${QUARTER_LABEL} ← ${t1.slice(0, 80)}…`);
        if (t2) console.log(`           T2 ${QUARTER_LABEL} ← ${t2.slice(0, 80)}…`);
        result.testimonials = { dryRun: true, t1: !!t1, t2: !!t2 };
        results.push(result);
        continue;
    }

    // Live uploads
    try {
        if (excelUrl) {
            const fileName = excelUrl.split("/").pop();
            const assetId  = await uploadFileToColumn(itemId, finCol.id, excelUrl, fileName);
            console.log(`           ✓ FIN → ${fileName} (asset ${assetId})`);
            result.fin = { assetId, fileName };
            countUploaded++;
        }
        await delay(DELAY_MS);

        if (pdfUrl) {
            const fileName = pdfUrl.split("/").pop();
            const assetId  = await uploadFileToColumn(itemId, narCol.id, pdfUrl, fileName);
            console.log(`           ✓ NAR → ${fileName} (asset ${assetId})`);
            result.nar = { assetId, fileName };
            countUploaded++;
        }
        await delay(DELAY_MS);

        if ((t1 || t2) && (t1Col || t2Col)) {
            await updateTestimonials(itemId, t1Col?.id, t2Col?.id, t1, t2);
            console.log(`           ✓ Testimonials written`);
            result.testimonials = { written: true };
            countTestimonials++;
            await delay(DELAY_MS);
        }

        results.push(result);
    } catch (err) {
        console.error(`           ✗ Upload error: ${err.message}`);
        result.status = "error";
        result.error  = err.message;
        results.push(result);
        countErrors++;
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n─── Summary ──────────────────────────────────────────────────────────");
console.log(`  Reports fetched:        ${reports.length}`);
console.log(`  Matched existing items: ${countMatched}`);
console.log(`  New items created:      ${countNew}`);
if (!DRY_RUN) {
    console.log(`  Files uploaded:         ${countUploaded}`);
    console.log(`  Testimonials written:   ${countTestimonials}`);
    console.log(`  Errors:                 ${countErrors}`);
}
console.log("──────────────────────────────────────────────────────────────────────\n");

writeFileSync("./output/import-results.json", JSON.stringify(results, null, 2));
console.log("Results saved to output/import-results.json");

// ── Stamp date pulled on all successfully processed items ─────────────────────

if (!DRY_RUN) {
    const pulledDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const successItems = results.filter((r) => r.itemId && r.status !== "error");
    console.log(`\nStamping date pulled (${pulledDate}) on ${successItems.length} items...`);
    let stamped = 0;
    for (const r of successItems) {
        try {
            await gql(
                `mutation($boardId: ID!, $itemId: ID!, $colVals: JSON!) {
                    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $colVals) { id }
                }`,
                {
                    boardId: BOARD_ID,
                    itemId: r.itemId,
                    colVals: JSON.stringify({ [PULLED_COL_ID]: pulledDate }),
                }
            );
            stamped++;
            await delay(DELAY_MS);
        } catch (err) {
            console.error(`  ✗ Failed to stamp ${r.langName} (${r.iso}): ${err.message}`);
        }
    }
    console.log(`  → Stamped ${stamped} of ${successItems.length} items`);
}
