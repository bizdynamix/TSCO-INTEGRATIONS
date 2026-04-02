/**
 * CABTAL Gifts Transformer
 * Reads MONTHLY DONORS, QUARTERLY DONORS, YEARLY DONORS, and ONE TIME DONORS
 * sheets from DCSE_CRM_RM_DATABASE.xlsx and produces a cleaned JSON array
 * ready for import into the Gifts board.
 *
 * Usage:
 *   node transform-gifts.js                — write output/gifts-cleaned.json
 *   node transform-gifts.js --dry-run      — print summary only, no file output
 *   node transform-gifts.js --show-flagged — also print flagged rows to console
 *
 * Output files:
 *   output/gifts-cleaned.json    — rows ready for import
 *   output/gifts-flagged.json    — rows needing manual review
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const {
    normalisePhone,
    normaliseDate,
    normaliseGiftStatus,
    GIFTS_COLS,
    GIFTS_GROUPS,
} = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const XLSX_FILE = path.join(__dirname, "DCSE_CRM_RM_DATABASE.xlsx");
const OUT_DIR = path.join(__dirname, "output");
const OUT_CLEAN = path.join(OUT_DIR, "gifts-cleaned.json");
const OUT_FLAGGED = path.join(OUT_DIR, "gifts-flagged.json");

const DRY_RUN = process.argv.includes("--dry-run");
const SHOW_FLAGGED = process.argv.includes("--show-flagged");

// ── Sheet definitions ─────────────────────────────────────────────────────────
// Each entry describes one source sheet and how to interpret its rows.
const GIFT_SHEETS = [
    {
        sheetName: "MONTHLY DONORS",
        frequency: "Monthly",
        groupId: GIFTS_GROUPS.pledged,
        amountCol: "AMOUNT",
        dateCol: "DATE OF FIRST PAYMENT",
        idCol: "ID",
    },
    {
        sheetName: "QUARTERLY DONORS",
        frequency: "Quarterly",
        groupId: GIFTS_GROUPS.pledged,
        amountCol: "AMOUNT",
        dateCol: "DATE OF FIRST PAYMENT",
        idCol: "ID",
    },
    {
        sheetName: "YEARLY DONORS",
        frequency: "Yearly",
        groupId: GIFTS_GROUPS.pledged,
        amountCol: "AMOUNT",
        dateCol: "DATE OF FIRST PAYMENT",
        idCol: "ID",
    },
    {
        sheetName: "ONE TIME DONORS",
        frequency: "One Time",
        groupId: GIFTS_GROUPS.oneTime,
        amountCol: "AMOUNT",
        dateCol: "DATE OF FIRST PAYMENT",
        idCol: "ID",
    },
    {
        sheetName: "DONORS",
        frequency: null,        // use FREQUENCY column if present
        groupId: GIFTS_GROUPS.financeIntake,
        amountCol: "AMOUNT",
        dateCol: "DATE OF FIRST PAYMENT",
        idCol: "ID",
    },
];

// ── Load workbook ─────────────────────────────────────────────────────────────
const wb = XLSX.readFile(XLSX_FILE, { cellDates: true });

const cleaned = [];
const flagged = [];
let totalRowsRead = 0;

// ── Process each sheet ────────────────────────────────────────────────────────
for (const sheetDef of GIFT_SHEETS) {
    const ws = wb.Sheets[sheetDef.sheetName];
    if (!ws) {
        console.warn(`⚠  Sheet "${sheetDef.sheetName}" not found — skipping.`);
        continue;
    }

    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    let sheetCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 2;

        // Skip rows that are purely totals/empty (no NAME and no AMOUNT with actual data)
        const rawName = String(r["NAME"] || "").trim();
        const rawAmount = r[sheetDef.amountCol];
        const hasAmount = rawAmount !== "" && rawAmount !== null && rawAmount !== undefined &&
            Number(rawAmount) > 0;

        if (!rawName && !hasAmount) continue;

        totalRowsRead++;
        sheetCount++;

        // --- Frequency / Status ---
        const freqRaw = sheetDef.frequency ||
            String(r["FREQUENCY"] || r["FREQ"] || "").trim();
        const status = normaliseGiftStatus(freqRaw);

        // --- Date ---
        const date = normaliseDate(r[sheetDef.dateCol]);

        // --- Amount ---
        const amount = hasAmount ? Number(rawAmount) : null;

        // --- Phone (used to match to People board) ---
        const phones = normalisePhone(r["TELEPHONE"]);
        const phone = phones[0] || "";

        // --- Partner / Finance system ID ---
        const partnerId = String(r[sheetDef.idCol] || r["NO"] || r["N0"] || "").trim();

        // --- Build record ---
        const record = {
            // Metadata
            _rowNum: rowNum,
            _sheet: sheetDef.sheetName,
            _partnerId: partnerId,
            _rawName: rawName,
            _rawPhone: phone,
            _frequency: freqRaw,

            // Monday.com Gifts board fields
            [GIFTS_COLS.name]: rawName || `Gift ${partnerId}`,
            [GIFTS_COLS.date]: date,
            [GIFTS_COLS.amount]: amount,
            [GIFTS_COLS.status]: status,

            // Import target
            _groupId: sheetDef.groupId,
        };

        // --- Flag logic ---
        const flags = [];
        if (!rawName) flags.push("no donor name — cannot match to People board");
        if (!amount) flags.push("zero or missing amount");
        if (!date) flags.push("no date — first payment date missing");
        if (!phone) flags.push("no telephone — cannot auto-match donor");
        // Duplicate detection: same name + phone + date across sheets
        const dupKey = `${rawName}|${phone}|${date}|${amount}`;
        const alreadySeen = cleaned.some(
            (c) => `${c._rawName}|${c._rawPhone}|${c[GIFTS_COLS.date]}|${c[GIFTS_COLS.amount]}` === dupKey
        );
        if (alreadySeen) flags.push("possible duplicate — same name/phone/date/amount seen before");

        if (flags.length > 0) {
            flagged.push({ rowNum, sheet: sheetDef.sheetName, name: rawName, flags, source: r, record });
        }

        cleaned.push(record);
    }

    console.log(`  Sheet "${sheetDef.sheetName}": ${sheetCount} real rows extracted.`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Transform Summary ────────────────────────────────────────`);
console.log(`  Total rows read    : ${totalRowsRead}`);
console.log(`  Records to import  : ${cleaned.length}`);
console.log(`  Flagged rows       : ${flagged.length}`);

// Amount stats
const totalAmt = cleaned.reduce((s, r) => s + (r[GIFTS_COLS.amount] || 0), 0);
console.log(`\n  Total donation amount in file : ${totalAmt.toLocaleString()} CFA`);

// Status breakdown
const statusBreakdown = {};
cleaned.forEach((r) => {
    statusBreakdown[r[GIFTS_COLS.status]] = (statusBreakdown[r[GIFTS_COLS.status]] || 0) + 1;
});
console.log(`  Gift status breakdown:`);
Object.entries(statusBreakdown).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

if (SHOW_FLAGGED && flagged.length > 0) {
    console.log(`\n── Flagged Gift Rows ────────────────────────────────────────`);
    flagged.forEach(({ rowNum, sheet, name, flags }) => {
        console.log(`  [${sheet}] Row ${rowNum}: "${name}"`);
        flags.forEach((f) => console.log(`    ⚠  ${f}`));
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
