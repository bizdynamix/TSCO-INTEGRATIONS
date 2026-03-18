/**
 * check-empty-items.js
 * Scans the board for items missing a FIN or NAR file for the current quarter,
 * or missing key text fields (ISO, ROLV). Outputs a report to stdout and saves
 * output/empty-items-report.json.
 *
 * Usage:
 *   node check-empty-items.js
 */

import { readFileSync, writeFileSync } from "fs";

const { MONDAY_API_TOKEN } = JSON.parse(readFileSync("./monday-secret.json", "utf8"));

const BOARD_ID      = "18242424286";
const QUARTER_LABEL = "Q1 2026";
const ROLV_COL_ID   = "text_mkwmdbe1";
const ISO_COL_ID    = "text_mkwjbhwm";
const PULLED_COL_ID = "text_mkwy5k28";
const DELAY_MS      = 300;

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

// Resolve quarter column IDs
const boardData = await gql(`query { boards(ids: [${BOARD_ID}]) { columns { id title } } }`);
const columns   = boardData?.boards?.[0]?.columns ?? [];
const finCol    = columns.find((c) => c.title === `FIN ${QUARTER_LABEL}`);
const narCol    = columns.find((c) => c.title === `NAR ${QUARTER_LABEL}`);
const t1Col     = columns.find((c) => c.title === `Testimonial 1 ${QUARTER_LABEL}`);
const t2Col     = columns.find((c) => c.title === `Testimonial 2 ${QUARTER_LABEL}`);

if (!finCol) throw new Error(`FIN ${QUARTER_LABEL} column not found`);
if (!narCol) throw new Error(`NAR ${QUARTER_LABEL} column not found`);

const checkColIds = [finCol.id, narCol.id, ROLV_COL_ID, ISO_COL_ID, PULLED_COL_ID];
if (t1Col) checkColIds.push(t1Col.id);
if (t2Col) checkColIds.push(t2Col.id);

console.log(`Checking board for empty/missing data (${QUARTER_LABEL})...\n`);

// Fetch all items
const items = [];
let cursor = null;
const colIds = JSON.stringify(checkColIds);

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
                            id text
                            ... on FileValue { files { assetId } }
                            ... on LongTextValue { text }
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
                                id text
                                ... on FileValue { files { assetId } }
                                ... on LongTextValue { text }
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
    await delay(DELAY_MS);
} while (cursor);

console.log(`Fetched ${items.length} items.\n`);

// Analyze each item
const issues = [];

for (const item of items) {
    const byId = {};
    for (const cv of item.column_values) byId[cv.id] = cv;

    const finFiles   = byId[finCol.id]?.files ?? [];
    const narFiles   = byId[narCol.id]?.files ?? [];
    const isoText    = byId[ISO_COL_ID]?.text?.trim() ?? "";
    const rolvText   = byId[ROLV_COL_ID]?.text?.trim() ?? "";
    const pulledText = byId[PULLED_COL_ID]?.text?.trim() ?? "";
    const t1Text     = t1Col ? (byId[t1Col.id]?.text?.trim() ?? "") : null;
    const t2Text     = t2Col ? (byId[t2Col.id]?.text?.trim() ?? "") : null;

    const flags = [];
    if (finFiles.length === 0)  flags.push("missing FIN file");
    if (narFiles.length === 0)  flags.push("missing NAR file");
    if (!isoText)               flags.push("missing ISO");
    if (!rolvText)              flags.push("missing ROLV");
    if (!pulledText)            flags.push("missing date pulled");
    if (t1Col && !t1Text)       flags.push("missing Testimonial 1");

    if (flags.length > 0) {
        issues.push({ id: item.id, name: item.name, iso: isoText, rolv: rolvText, flags });
    }
}

// Report
if (issues.length === 0) {
    console.log("✓ No issues found — all items have files, ISO, ROLV, and date pulled.\n");
} else {
    console.log(`Found ${issues.length} item(s) with issues:\n`);
    for (const issue of issues) {
        console.log(`  ${issue.name} (id: ${issue.id})`);
        console.log(`    ISO: ${issue.iso || "(empty)"}  ROLV: ${issue.rolv || "(empty)"}`);
        console.log(`    ⚠ ${issue.flags.join(", ")}`);
    }
    console.log();
}

// Group by flag type for summary
const flagCounts = {};
for (const issue of issues) {
    for (const flag of issue.flags) {
        flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
    }
}

console.log("─── Summary ──────────────────────────────────────────────────────────");
console.log(`  Total items:    ${items.length}`);
console.log(`  Items with issues: ${issues.length}`);
for (const [flag, count] of Object.entries(flagCounts)) {
    console.log(`    ${flag}: ${count}`);
}
console.log("──────────────────────────────────────────────────────────────────────\n");

writeFileSync("./output/empty-items-report.json", JSON.stringify(issues, null, 2));
console.log("Report saved to output/empty-items-report.json");
