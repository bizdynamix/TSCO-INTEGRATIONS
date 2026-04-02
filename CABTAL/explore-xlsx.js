/**
 * CABTAL XLSX Explorer
 * Read-only profiler for DCSE_CRM_RM_DATABASE.xlsx
 *
 * Usage:
 *   node explore-xlsx.js               — print headers, row count, sample rows, stats
 *   node explore-xlsx.js --full        — also print all unique values per column (for church-name normalisation)
 *   node explore-xlsx.js --sheet NAME  — inspect a specific sheet by name
 */

const XLSX = require("xlsx");
const path = require("path");

const FILE = path.join(__dirname, "DCSE_CRM_RM_DATABASE.xlsx");
const FULL = process.argv.includes("--full");
const SHEET_ARG = (() => {
    const i = process.argv.indexOf("--sheet");
    return i !== -1 ? process.argv[i + 1] : null;
})();
const SAMPLE_ROWS = 10;

// ── Load workbook ─────────────────────────────────────────────────────────────
const wb = XLSX.readFile(FILE, { cellDates: true });
console.log(`\nFile: ${FILE}`);
console.log(`Sheets: ${wb.SheetNames.join(", ")}`);

const sheetNames = SHEET_ARG
    ? [SHEET_ARG]
    : wb.SheetNames;

// ── Inspect each sheet ────────────────────────────────────────────────────────
for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
        console.log(`\n⚠️  Sheet "${sheetName}" not found.`);
        continue;
    }

    // Convert to array-of-objects (first row = headers)
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    console.log(`\n${"═".repeat(72)}`);
    console.log(`SHEET: "${sheetName}"  |  Rows: ${rows.length}  |  Columns: ${headers.length}`);
    console.log(`${"═".repeat(72)}`);

    // ── Column inventory ─────────────────────────────────────────────────────
    console.log(`\n── Columns (${headers.length}) ${"─".repeat(50)}`);
    headers.forEach((h, i) => {
        const values = rows.map((r) => r[h] ?? "").filter((v) => v !== "" && v !== null);
        const filled = values.length;
        const pct = rows.length > 0 ? ((filled / rows.length) * 100).toFixed(0) : 0;
        const unique = new Set(values.map(String)).size;
        const sample = values.slice(0, 3).map(String).join(" | ");
        console.log(
            `  [${String(i + 1).padStart(2)}] ${String(h).padEnd(35)} filled: ${String(filled).padStart(5)}/${rows.length} (${pct}%)  unique: ${String(unique).padStart(5)}  sample: ${sample}`
        );
    });

    // ── Sample rows ──────────────────────────────────────────────────────────
    console.log(`\n── First ${Math.min(SAMPLE_ROWS, rows.length)} rows ${"─".repeat(55)}`);
    rows.slice(0, SAMPLE_ROWS).forEach((row, i) => {
        console.log(`\n  Row ${i + 1}:`);
        for (const [k, v] of Object.entries(row)) {
            if (v !== "" && v !== null && v !== undefined) {
                console.log(`    ${String(k).padEnd(35)} = ${JSON.stringify(v)}`);
            }
        }
    });

    // ── Potential phone / WhatsApp columns ───────────────────────────────────
    console.log(`\n── Phone / WhatsApp column candidates ${"─".repeat(35)}`);
    const phoneKeywords = /phone|tel|whatsapp|mobile|number|contact|num/i;
    const phoneCols = headers.filter((h) => phoneKeywords.test(h));
    if (phoneCols.length === 0) {
        console.log("  (none found by keyword — check column names above)");
    } else {
        phoneCols.forEach((col) => {
            const vals = rows.map((r) => r[col]).filter((v) => v !== "");
            const multiEntry = vals.filter((v) => /[,;\/]/.test(String(v)));
            console.log(`  "${col}": ${vals.length} non-empty, ${multiEntry.length} with multiple entries (comma/semicolon/slash)`);
            if (vals.length > 0) {
                console.log(`    samples: ${vals.slice(0, 5).join(" | ")}`);
            }
        });
    }

    // ── Church / organisation column candidates ──────────────────────────────
    console.log(`\n── Church / Organization column candidates ${"─".repeat(30)}`);
    const churchKeywords = /church|org|eglise|parish|congregation|assoc|denomination/i;
    const churchCols = headers.filter((h) => churchKeywords.test(h));
    if (churchCols.length === 0) {
        console.log("  (none found by keyword — check column names above)");
    } else {
        churchCols.forEach((col) => {
            const vals = rows.map((r) => r[col]).filter((v) => v !== "");
            const unique = [...new Set(vals.map(String))].sort();
            console.log(`  "${col}": ${vals.length} non-empty, ${unique.length} unique values`);
            console.log(`    ${unique.slice(0, 20).join(" | ")}${unique.length > 20 ? " …" : ""}`);
        });
    }

    // ── Name column analysis ─────────────────────────────────────────────────
    console.log(`\n── Name column analysis ${"─".repeat(49)}`);
    const nameKeywords = /^name$|^full.?name$|^nom$|prenom|firstname|first.name|last.name/i;
    const nameCols = headers.filter((h) => nameKeywords.test(h));
    if (nameCols.length === 0) {
        // Fall back: first column is usually the name
        const firstCol = headers[0];
        console.log(`  No obvious name column found. Checking first column: "${firstCol}"`);
        const vals = rows.map((r) => r[firstCol]).filter((v) => v !== "");
        const tokenCounts = vals.map((v) => String(v).trim().split(/\s+/).length);
        const avg = tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length;
        const multi = tokenCounts.filter((n) => n > 2).length;
        console.log(`    ${vals.length} non-empty, avg tokens: ${avg.toFixed(1)}, rows with >2 tokens: ${multi}`);
    } else {
        nameCols.forEach((col) => {
            const vals = rows.map((r) => r[col]).filter((v) => v !== "");
            const tokenCounts = vals.map((v) => String(v).trim().split(/\s+/).length);
            const avg = tokenCounts.reduce((a, b) => a + b, 0) / (tokenCounts.length || 1);
            const multi = tokenCounts.filter((n) => n > 2).length;
            console.log(`  "${col}": ${vals.length} non-empty, avg tokens: ${avg.toFixed(1)}, rows with >2 tokens: ${multi}`);
            console.log(`    samples: ${vals.slice(0, 5).join(" | ")}`);
        });
    }

    // ── Full unique-value dump (--full) ──────────────────────────────────────
    if (FULL) {
        console.log(`\n── All Unique Values Per Column ${"─".repeat(41)}`);
        headers.forEach((col) => {
            const vals = rows.map((r) => r[col]).filter((v) => v !== "");
            const unique = [...new Set(vals.map(String))].sort();
            console.log(`\n  "${col}" (${unique.length} unique):`);
            unique.forEach((v) => console.log(`    • ${v}`));
        });
    }
}

console.log("\n\nDone.\n");
