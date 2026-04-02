/**
 * CABTAL Review — Unmatched / Flagged Records Report
 * Prints a human-readable table of every record flagged during transformation.
 * Mark's team uses this to resolve issues before re-running imports.
 *
 * Usage:
 *   node review-unmatched.js            — print full report
 *   node review-unmatched.js --people   — people flags only
 *   node review-unmatched.js --gifts    — gifts flags only
 *   node review-unmatched.js --churches — church normalisation issues only
 *   node review-unmatched.js --csv      — output CSV to output/review-report.csv
 */

const fs = require("fs");
const path = require("path");

const PEOPLE_FLAGS = path.join(__dirname, "output", "people-flagged.json");
const GIFTS_FLAGS = path.join(__dirname, "output", "gifts-flagged.json");
const CSV_OUT = path.join(__dirname, "output", "review-report.csv");

const SHOW_PEOPLE = !process.argv.includes("--gifts") && !process.argv.includes("--churches");
const SHOW_GIFTS = !process.argv.includes("--people") && !process.argv.includes("--churches");
const SHOW_CHURCHES = !process.argv.includes("--people") && !process.argv.includes("--gifts");
const CSV_MODE = process.argv.includes("--csv");

// ── Load flagged files ────────────────────────────────────────────────────────
function loadFlagged(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠  File not found: ${filePath}`);
        console.warn(`     Run transform-people.js / transform-gifts.js first.`);
        return [];
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const peopleFlagged = loadFlagged(PEOPLE_FLAGS);
const giftsFlagged = loadFlagged(GIFTS_FLAGS);

// ── People flags ──────────────────────────────────────────────────────────────
if (SHOW_PEOPLE || process.argv.includes("--people")) {
    console.log(`\n${"═".repeat(72)}`);
    console.log(`PEOPLE BOARD — FLAGGED RECORDS (${peopleFlagged.length})`);
    console.log(`${"═".repeat(72)}`);

    if (peopleFlagged.length === 0) {
        console.log("  (none)");
    } else {
        peopleFlagged.forEach(({ rowNum, itemName, flags, source }) => {
            const name = itemName || source?.NAME || "(no name)";
            const church = source?.CHURCH || "";
            const phone = source?.TELEPHONE || "";
            const city = source?.CITY || "";
            console.log(`\n  Row ${String(rowNum).padStart(3)}  ${name}`);
            console.log(`         Phone: ${phone}  Church: ${church}  City: ${city}`);
            flags?.forEach(f => console.log(`         ⚠  ${f}`));
        });
    }
}

// ── Church normalisation issues ───────────────────────────────────────────────
if (SHOW_CHURCHES || process.argv.includes("--churches")) {
    const churchIssues = peopleFlagged.filter(r =>
        r.flags?.some(f => f.includes("church"))
    );

    console.log(`\n${"═".repeat(72)}`);
    console.log(`CHURCH NORMALISATION ISSUES (${churchIssues.length} records)`);
    console.log(`${"═".repeat(72)}`);

    // Aggregate by raw church name
    const byChurch = {};
    churchIssues.forEach(({ source, flags }) => {
        const raw = (source?.CHURCH || "").trim();
        if (!byChurch[raw]) byChurch[raw] = { flags: new Set(), rows: [] };
        flags?.forEach(f => f.includes("church") && byChurch[raw].flags.add(f));
        byChurch[raw].rows.push(source?.NAME || "?");
    });

    if (Object.keys(byChurch).length === 0) {
        console.log("  (none)");
    } else {
        console.log(`\n  These raw church values need to be added to CHURCH_NORM in mapping-config.js:\n`);
        Object.entries(byChurch).sort(([a], [b]) => a.localeCompare(b)).forEach(([raw, { flags, rows }]) => {
            console.log(`  "${raw}"`);
            flags.forEach(f => console.log(`    ⚠  ${f}`));
            console.log(`    Affects: ${rows.slice(0, 5).join(", ")}${rows.length > 5 ? ` … (${rows.length} total)` : ""}`);
        });
        console.log(`\n  Suggested entry format for mapping-config.js:`);
        Object.keys(byChurch).sort().forEach(raw => {
            const key = raw.toLowerCase().trim();
            console.log(`  "${key}": "CANONICAL NAME HERE",`);
        });
    }
}

// ── Gifts flags ───────────────────────────────────────────────────────────────
if (SHOW_GIFTS || process.argv.includes("--gifts")) {
    console.log(`\n${"═".repeat(72)}`);
    console.log(`GIFTS BOARD — FLAGGED RECORDS (${giftsFlagged.length})`);
    console.log(`${"═".repeat(72)}`);

    if (giftsFlagged.length === 0) {
        console.log("  (none)");
    } else {
        giftsFlagged.forEach(({ rowNum, sheet, name, flags, source }) => {
            const phone = source?.TELEPHONE || "";
            const amount = source?.AMOUNT || "";
            console.log(`\n  [${sheet}] Row ${String(rowNum).padStart(3)}  "${name}"`);
            console.log(`         Phone: ${phone}  Amount: ${amount}`);
            flags?.forEach(f => console.log(`         ⚠  ${f}`));
        });
    }
}

// ── Overall stats ─────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(72)}`);
console.log(`SUMMARY`);
console.log(`${"═".repeat(72)}`);
console.log(`  People flagged : ${peopleFlagged.length}`);
console.log(`  Gifts flagged  : ${giftsFlagged.length}`);

const unresolvableChurches = peopleFlagged.filter(r =>
    r.flags?.some(f => f.includes("unresolvable"))
).length;
const eventNames = peopleFlagged.filter(r =>
    r.flags?.some(f => f.includes("event name"))
).length;
console.log(`\n  People → unresolvable church  : ${unresolvableChurches}`);
console.log(`  People → event name as church  : ${eventNames}`);
console.log(`  People → no phone             : ${peopleFlagged.filter(r => r.flags?.some(f => f.includes("no phone"))).length}`);
console.log(`  Gifts  → no donor match       : ${giftsFlagged.filter(r => r.flags?.some(f => f.includes("name"))).length}`);
console.log(`  Gifts  → no date              : ${giftsFlagged.filter(r => r.flags?.some(f => f.includes("date"))).length}`);

// ── CSV export ────────────────────────────────────────────────────────────────
if (CSV_MODE) {
    const rows = [];
    rows.push(["Type", "Sheet/Board", "Row", "Name", "Phone", "Church/Amount", "Flags"]);

    peopleFlagged.forEach(({ rowNum, source, flags }) => {
        rows.push([
            "People",
            "SUBSCRIBERS",
            rowNum,
            source?.NAME || "",
            source?.TELEPHONE || "",
            source?.CHURCH || "",
            (flags || []).join("; "),
        ]);
    });

    giftsFlagged.forEach(({ rowNum, sheet, name, source, flags }) => {
        rows.push([
            "Gifts",
            sheet,
            rowNum,
            name,
            source?.TELEPHONE || "",
            source?.AMOUNT || "",
            (flags || []).join("; "),
        ]);
    });

    const csv = rows.map(r => r.map(cell =>
        `"${String(cell).replace(/"/g, '""')}"`
    ).join(",")).join("\n");

    if (!fs.existsSync(path.join(__dirname, "output"))) {
        fs.mkdirSync(path.join(__dirname, "output"));
    }
    fs.writeFileSync(CSV_OUT, csv);
    console.log(`\nCSV written → ${CSV_OUT}`);
}

console.log("\nDone.\n");
