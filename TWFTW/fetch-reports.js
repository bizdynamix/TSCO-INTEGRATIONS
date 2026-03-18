/**
 * fetch-reports.js
 * Fetches SCBTF reports from the ERA API for a given year/quarter
 * and saves raw JSON to output/reports-raw.json
 *
 * Usage: node fetch-reports.js [year] [quarter]
 *   Defaults: year=2026, quarter=1
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";

const { ERA_API_KEY } = JSON.parse(readFileSync("./monday-secret.json", "utf8"));
const ERA_API_URL = "https://era.twftw.net/v1/api/reports/scbtf/";

const year = parseInt(process.argv[2] ?? "2026");
const quarter = parseInt(process.argv[3] ?? "1");

console.log(`Fetching SCBTF reports for Q${quarter} ${year}...`);

const res = await fetch(ERA_API_URL, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "AUTH-API-KEY": ERA_API_KEY,
    },
    body: JSON.stringify({ year, quarter }),
});

if (!res.ok) throw new Error(`ERA API error: ${res.status} ${res.statusText}`);

const json = await res.json();

if (!json.success) throw new Error(`ERA API returned success=false: ${JSON.stringify(json)}`);

console.log(`  → ${json.data.length} reports received`);

mkdirSync("./output", { recursive: true });
writeFileSync("./output/reports-raw.json", JSON.stringify(json.data, null, 2));
console.log("  → Saved to output/reports-raw.json");
