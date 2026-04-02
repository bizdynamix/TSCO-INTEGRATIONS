/**
 * CABTAL Organizations Transformer
 * Reads the CHURCHES sheet from DCSE_CRM_RM_DATABASE.xlsx and produces a
 * cleaned JSON array ready for import into the Organizations board.
 *
 * Usage:
 *   node transform-orgs.js                  — write output/orgs-cleaned.json
 *   node transform-orgs.js --dry-run        — print summary only, no file output
 *   node transform-orgs.js --show-flagged   — also print flagged rows to console
 *
 * Output files:
 *   output/orgs-cleaned.json    — rows ready for import
 *   output/orgs-flagged.json    — rows needing manual review
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const { normalisePhone, normaliseDate, BOARDS } = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const XLSX_FILE = path.join(__dirname, "DCSE_CRM_RM_DATABASE.xlsx");
const SHEET_NAME = "CHURCHES";
const OUT_DIR = path.join(__dirname, "output");
const OUT_CLEAN = path.join(OUT_DIR, "orgs-cleaned.json");
const OUT_FLAGGED = path.join(OUT_DIR, "orgs-flagged.json");

const DRY_RUN = process.argv.includes("--dry-run");
const SHOW_FLAGGED = process.argv.includes("--show-flagged");

// ── Orgs board column IDs (confirmed from explore-boards.js) ─────────────────
const ORGS_COLS = {
    name:          "name",              // item name (church name)
    orgType:       "color_mkw9hkdb",    // Organization Type status: Church/NGO/etc
    denomination:  "dropdown_mkx5q5ga", // Denomination dropdown: CBC/EEC/FGM/etc
    pastorName:    "text_mkxd4aq0",     // Pastor's Name (text)
    pastorPhone:   "phone",             // Pastor's Phone (phone)
    orgStatus:     "color_mkwbw323",    // ORG Status: Active/Potential/Dormant
    lastBtsDate:   "date4",             // Original Contact Date (repurposed as last BTS)
    // read-only / skipped: location (requires geocodable address), subitems, mirrors
};

// ── Orgs board group IDs ──────────────────────────────────────────────────────
const ORGS_GROUPS = {
    active:   "topics",     // Active
    dormant:  "new_group",  // Dormant Relationships
};

// Default import group — all from XLSX go to Active unless flagged
const ORGS_IMPORT_GROUP = ORGS_GROUPS.active;

// ── Denomination normalisation ────────────────────────────────────────────────
// Maps raw DENOMINATION cell (lowercased) to the dropdown label in the Orgs board.
// Board dropdown labels: CBC, PC, Redeemed, EEC, EELC, AG, FGM, TACC, EPC, EMEC, MPE
const DENOM_MAP = {
    "cbc":      "CBC",
    "eec":      "EEC",
    "eelc":     "EELC",
    "fgm":      "FGM",
    "tacc":     "TACC",
    "tac":      "TACC",   // variant
    "epc":      "EPC",
    "emec":     "EMEC",
    "rccg":     "Redeemed",
    "redeemed": "Redeemed",
    "ag":       "AG",
    "mpe":      "MPE",
    "pc":       "PC",
};

function normaliseDenom(raw) {
    if (!raw || String(raw).trim() === "") return null;
    return DENOM_MAP[String(raw).trim().toLowerCase()] || null;
}

// ── Load sheet ────────────────────────────────────────────────────────────────
const wb = XLSX.readFile(XLSX_FILE, { cellDates: true });
const ws = wb.Sheets[SHEET_NAME];
if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
}
const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
console.log(`Loaded ${rows.length} rows from "${SHEET_NAME}" sheet.`);

// ── Transform ─────────────────────────────────────────────────────────────────
const cleaned = [];
const flagged = [];

for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    // Church name is the item name
    const rawName = String(r["NAME OF CHURCH"] || r["NAME OF CHURCH "] || "").trim();
    if (!rawName) {
        flagged.push({ rowNum, source: r, reason: "Empty NAME OF CHURCH — skipped", record: null });
        continue;
    }

    // Pastor info
    const pastorName = String(r["NAME OF PASTOR"] || "").trim();
    const pastorPhones = normalisePhone(r["PASTOR' S CONTACT"] || r["PASTOR'S CONTACT"] || "");
    const pastorPhone = pastorPhones[0] || "";

    // Denomination
    const rawDenom = String(r[" DENOMINATION"] || r["DENOMINATION"] || "").trim();
    const denomination = normaliseDenom(rawDenom);

    // Date of last BTS
    const lastBtsDate = normaliseDate(r["DATE OF LAST BTS"]);

    // Location (city only — location column needs full address for API, store as note)
    const city = String(r["LOCATION"] || "").trim();

    // Build record
    const record = {
        _rowNum: rowNum,
        _rawName: rawName,
        _rawDenom: rawDenom,
        _city: city,

        // Monday.com Orgs board fields
        [ORGS_COLS.name]:         rawName,
        [ORGS_COLS.orgType]:      "Church",           // all rows in CHURCHES sheet are churches
        [ORGS_COLS.denomination]: denomination,
        [ORGS_COLS.pastorName]:   pastorName,
        [ORGS_COLS.pastorPhone]:  pastorPhone,
        [ORGS_COLS.orgStatus]:    "Active",            // default all to Active
        [ORGS_COLS.lastBtsDate]:  lastBtsDate,

        _groupId: ORGS_IMPORT_GROUP,
    };

    // Flag logic
    const flags = [];
    if (!pastorName)    flags.push("no pastor name");
    if (!pastorPhone)   flags.push("no pastor phone");
    if (!denomination)  flags.push(`denomination unmapped: "${rawDenom}"`);
    if (!lastBtsDate)   flags.push("no last BTS date");

    if (flags.length > 0) {
        flagged.push({ rowNum, name: rawName, flags, source: r, record });
    }

    cleaned.push(record);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Transform Summary ────────────────────────────────────────`);
console.log(`  Total rows processed : ${rows.length}`);
console.log(`  Records to import    : ${cleaned.length}`);
console.log(`  Rows with flags      : ${flagged.length}`);
console.log(`  Rows skipped (empty) : ${rows.length - cleaned.length - flagged.filter(f => !f.record).length}`);

const denomBreakdown = {};
cleaned.forEach(r => {
    const d = r[ORGS_COLS.denomination] || "(unmapped)";
    denomBreakdown[d] = (denomBreakdown[d] || 0) + 1;
});
console.log(`\n  Denomination breakdown:`);
Object.entries(denomBreakdown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`    ${k}: ${v}`)
);

if (SHOW_FLAGGED && flagged.length > 0) {
    console.log(`\n── Flagged Rows ─────────────────────────────────────────────`);
    flagged.forEach(({ rowNum, name, flags, reason }) => {
        console.log(`  Row ${rowNum}: "${name || "(no name)"}"`);
        if (reason) console.log(`    ! ${reason}`);
        (flags || []).forEach(f => console.log(`    ! ${f}`));
    });
}

// ── Write output ──────────────────────────────────────────────────────────────
if (!DRY_RUN) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
    fs.writeFileSync(OUT_CLEAN, JSON.stringify(cleaned, null, 2));
    fs.writeFileSync(OUT_FLAGGED, JSON.stringify(flagged, null, 2));
    console.log(`\nWrote ${cleaned.length} records → ${OUT_CLEAN}`);
    console.log(`Wrote ${flagged.length} flagged  → ${OUT_FLAGGED}`);
} else {
    console.log("\n(dry-run — no files written)");
}

console.log("\nDone.\n");
