/**
 * import-reports.js
 * For each Q1 2026 report from ERA API:
 *   - If item already exists on board (matched by LanguageISO): upload files to FIN/NAR columns
 *   - If no match: create a new item, then upload files
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

const BOARD_ID       = "18291610070";
const GROUP_ID       = "group_mkwxwgj1";
const ISO_COL_ID     = "text_mkwjbhwm";   // Language ISO/EthCode — used for matching
const ROLV_COL_ID    = "text_mkwmdbe1";   // ROD/ROLV
const SOURCE_COL_ID  = "text_mkwmq1bz";   // Data Source

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

// ── Fetch all board items, return map of ISO → item id ────────────────────────

async function fetchISOtoItemMap() {
    const items = [];
    let cursor = null;

    do {
        let data;
        if (cursor) {
            data = await gql(
                `query($cursor: String!) {
                    next_items_page(limit: 100, cursor: $cursor) {
                        cursor
                        items { id column_values(ids: ["${ISO_COL_ID}"]) { text } }
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
                            items { id column_values(ids: ["${ISO_COL_ID}"]) { text } }
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

    const map = {};
    for (const item of items) {
        const iso = item.column_values?.[0]?.text?.trim();
        if (iso) map[iso] = item.id;
    }
    return map;
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

// Resolve FIN / NAR column IDs by title (safe against ID changes)
const boardData = await gql(`query { boards(ids: [${BOARD_ID}]) { columns { id title } } }`);
const columns   = boardData?.boards?.[0]?.columns ?? [];
const finCol    = columns.find((c) => c.title === "FIN Q1 2026");
const narCol    = columns.find((c) => c.title === "NAR Q1 2026");

if (!finCol) throw new Error("FIN Q1 2026 column not found on board.");
if (!narCol) throw new Error("NAR Q1 2026 column not found on board.");

console.log(`Columns: FIN Q1 2026 → ${finCol.id}  |  NAR Q1 2026 → ${narCol.id}\n`);

// Fetch existing items
console.log("Fetching board items...");
const isoMap = await fetchISOtoItemMap();
console.log(`  → ${Object.keys(isoMap).length} existing items mapped by ISO\n`);

const results = [];
let countMatched = 0, countNew = 0, countUploaded = 0, countErrors = 0;

for (const report of reports) {
    const iso      = report.LanguageISO?.trim();
    const langName = report.LanguageName ?? iso;
    const rolv     = report.LanguageROLV ?? null;
    const excelUrl = report.PNPExcel ?? null;
    const pdfUrl   = report.PNPPDF   ?? null;

    let itemId  = isoMap[iso];
    let isNew   = false;
    const result = { iso, langName, status: "ok", isNew: false, fin: null, nar: null };

    // ── Create item if not on board ──────────────────────────────────────────
    if (!itemId) {
        isNew = true;
        result.isNew = true;
        countNew++;

        if (DRY_RUN) {
            console.log(`  [NEW]    ${langName} (${iso}) — would create item`);
        } else {
            console.log(`  [CREATE] ${langName} (${iso})`);
            try {
                itemId = await createItem(langName, iso, rolv);
                isoMap[iso] = itemId; // prevent duplicates if ISO appears twice
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
            console.log(`           FIN Q1 2026 ← ${fileName}`);
            result.fin = { dryRun: true, url: excelUrl, fileName };
        }
        if (pdfUrl) {
            const fileName = pdfUrl.split("/").pop();
            console.log(`           NAR Q1 2026 ← ${fileName}`);
            result.nar = { dryRun: true, url: pdfUrl, fileName };
        }
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
    console.log(`  Errors:                 ${countErrors}`);
}
console.log("──────────────────────────────────────────────────────────────────────\n");

writeFileSync("./output/import-results.json", JSON.stringify(results, null, 2));
console.log("Results saved to output/import-results.json");
