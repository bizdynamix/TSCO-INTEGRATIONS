/**
 * dedup-files.js
 * For each item on the board, check the FIN and NAR file columns for the
 * current quarter. If a column has more than one asset, delete all but the
 * most recently uploaded one (highest asset ID).
 *
 * Usage:
 *   node dedup-files.js --dry-run   (log what would be deleted, no writes)
 *   node dedup-files.js             (live — deletes duplicate assets)
 */

import { readFileSync } from "fs";

const { MONDAY_API_TOKEN } = JSON.parse(readFileSync("./monday-secret.json", "utf8"));

const BOARD_ID      = "18242424286";
const QUARTER_LABEL = "Q1 2026";
const DRY_RUN       = process.argv.includes("--dry-run");
const DELAY_MS      = 500;

if (DRY_RUN) console.log("DRY RUN MODE — no deletes will occur\n");

function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

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

async function deleteAsset(assetId) {
    const data = await gql(
        `mutation($assetId: ID!) { delete_asset(id: $assetId) { id } }`,
        { assetId }
    );
    return data?.delete_asset?.id;
}

// Fetch all board items with their file assets for the two quarter columns
async function fetchItemsWithAssets(finColId, narColId) {
    const items = [];
    let cursor = null;
    const colIds = JSON.stringify([finColId, narColId]);

    do {
        let data;
        if (cursor) {
            data = await gql(
                `query($cursor: String!) {
                    next_items_page(limit: 50, cursor: $cursor) {
                        cursor
                        items {
                            id name
                            column_values(ids: ${colIds}) {
                                id
                                ... on FileValue { files { assetId } }
                            }
                        }
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
                        items_page(limit: 50) {
                            cursor
                            items {
                                id name
                                column_values(ids: ${colIds}) {
                                    id
                                    ... on FileValue { files { assetId } }
                                }
                            }
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
        await delay(300);
    } while (cursor);

    return items;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Resolve column IDs by title
const boardData = await gql(`query { boards(ids: [${BOARD_ID}]) { columns { id title } } }`);
const columns   = boardData?.boards?.[0]?.columns ?? [];
const finCol    = columns.find((c) => c.title === `FIN ${QUARTER_LABEL}`);
const narCol    = columns.find((c) => c.title === `NAR ${QUARTER_LABEL}`);

if (!finCol) throw new Error(`FIN ${QUARTER_LABEL} column not found`);
if (!narCol) throw new Error(`NAR ${QUARTER_LABEL} column not found`);

console.log(`FIN column: ${finCol.id}  |  NAR column: ${narCol.id}\n`);
console.log("Fetching board items with file assets...");

const items = await fetchItemsWithAssets(finCol.id, narCol.id);
console.log(`  → ${items.length} items fetched\n`);

let totalDups = 0, totalDeleted = 0, totalErrors = 0;

for (const item of items) {
    for (const col of item.column_values) {
        const files = col?.files ?? [];
        if (files.length <= 1) continue;

        // Sort descending by assetId (numeric) — highest = most recent upload
        const sorted   = [...files].sort((a, b) => Number(b.assetId) - Number(a.assetId));
        const keep     = sorted[0];
        const toDelete = sorted.slice(1);

        totalDups += toDelete.length;
        const colLabel = col.id === finCol.id ? "FIN" : "NAR";
        console.log(`  ${item.name} — ${colLabel}: keep asset ${keep.assetId}, delete ${toDelete.map((f) => f.assetId).join(", ")}`);

        if (!DRY_RUN) {
            for (const f of toDelete) {
                try {
                    await deleteAsset(f.assetId);
                    console.log(`    ✓ deleted asset ${f.assetId}`);
                    totalDeleted++;
                    await delay(DELAY_MS);
                } catch (err) {
                    console.error(`    ✗ failed to delete asset ${f.assetId}: ${err.message}`);
                    totalErrors++;
                }
            }
        }
    }
}

console.log("\n─── Summary ──────────────────────────────────────────────────────────");
console.log(`  Duplicate assets found:  ${totalDups}`);
if (!DRY_RUN) {
    console.log(`  Assets deleted:          ${totalDeleted}`);
    console.log(`  Errors:                  ${totalErrors}`);
}
console.log("──────────────────────────────────────────────────────────────────────");
