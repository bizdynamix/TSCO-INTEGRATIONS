/**
 * CABTAL People Transformer
 * Reads the SUBSCRIBERS sheet from DCSE_CRM_RM_DATABASE.xlsx and produces
 * a cleaned JSON array ready for import into the People board.
 *
 * Usage:
 *   node transform-people.js                  — write output/people-cleaned.json
 *   node transform-people.js --dry-run        — print summary only, no file output
 *   node transform-people.js --show-flagged   — also print flagged rows to console
 *
 * Output files:
 *   output/people-cleaned.json    — rows ready for import
 *   output/people-flagged.json    — rows needing manual review before import
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const {
    normaliseChurch,
    normaliseResourceType,
    normalisePhone,
    splitName,
    inferPartnerType,
    normaliseDate,
    PEOPLE_COLS,
    PEOPLE_IMPORT_GROUP,
} = require("./mapping-config");

// ── Config ────────────────────────────────────────────────────────────────────
const XLSX_FILE = path.join(__dirname, "DCSE_CRM_RM_DATABASE.xlsx");
const SHEET_NAME = "SUBSCRIBERS";
const OUT_DIR = path.join(__dirname, "output");
const OUT_CLEAN = path.join(OUT_DIR, "people-cleaned.json");
const OUT_FLAGGED = path.join(OUT_DIR, "people-flagged.json");

const DRY_RUN = process.argv.includes("--dry-run");
const SHOW_FLAGGED = process.argv.includes("--show-flagged");

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
    const rowNum = i + 2; // 1-based + header

    // --- Name ---
    const rawName = String(r["NAME"] ?? "").trim();
    if (!rawName || rawName === "undefined") {
        flagged.push({ rowNum, source: r, reason: "Empty NAME — skipped" });
        continue;
    }
    const { firstName, lastName, middleNames, flagForReview } = splitName(rawName);

    // --- Phone / WhatsApp ---
    const phones = normalisePhone(r["TELEPHONE"]);
    const whatsApp1 = phones[0] || "";
    const whatsApp2 = phones[1] || ""; // second number if present

    // --- Unique item name: "FULL NAME | TEL" (matches existing board convention) ---
    const itemName = whatsApp1
        ? `${rawName} | ${whatsApp1}`
        : rawName;

    // --- Church normalisation ---
    const rawChurch = String(r["CHURCH"] || "").trim();
    const { canonical: churchNorm, matched: churchMatched, isEvent } = normaliseChurch(rawChurch);

    // --- City / Location ---
    const city = String(r["CITY"] || "").trim();

    // --- Email ---
    const email = String(r["EMAIL"] || "").trim();

    // --- Resource Type ---
    const resourceType = normaliseResourceType(r["OTHER SUBSCRIPTION"]);
    const partnerType = inferPartnerType(rawName);

    // --- Subscription / Contact Date ---
    const subscriptionDate = normaliseDate(r["SUBSCRIPTION DATE"]);

    // --- Assigned coordinator (@dropdown in source = the form respondent's contact) ---
    // We store it as a note in pointsOfInterest; can't auto-assign people columns from a name string
    const assignedDropdown = String(r["@dropdown"] || "").trim();

    // --- Build cleaned record ---
    const record = {
        // Metadata (not sent to Monday, used for matching/logging)
        _rowNum: rowNum,
        _sourceNo: r["NO"] || "",
        _rawName: rawName,
        _rawChurch: rawChurch,
        _rawPhone: r["TELEPHONE"],
        _assignedTo: assignedDropdown,

        // Monday.com People board fields
        [PEOPLE_COLS.name]: itemName,
        [PEOPLE_COLS.firstName]: firstName,
        [PEOPLE_COLS.lastName]: lastName,
        [PEOPLE_COLS.middleName]: middleNames,
        [PEOPLE_COLS.whatsApp]: whatsApp1,
        [PEOPLE_COLS.email]: email,
        [PEOPLE_COLS.churchNameRaw]: rawChurch,
        [PEOPLE_COLS.churchNameNorm]: churchNorm || rawChurch,
        [PEOPLE_COLS.location]: city,
        [PEOPLE_COLS.partnerType]: partnerType,
        [PEOPLE_COLS.resourceType]: resourceType,
        [PEOPLE_COLS.firstContactDate]: subscriptionDate,

        // Import target group
        _groupId: PEOPLE_IMPORT_GROUP,

        // Extra cleaned fields for WhatsApp 2 (if present)
        _whatsApp2: whatsApp2,
    };

    // --- Flag logic ---
    const flags = [];
    if (flagForReview) flags.push("name has >3 tokens — check split");
    if (!churchMatched) flags.push(`church not in norm map: "${rawChurch}"`);
    if (isEvent) flags.push(`church field is an event name: "${rawChurch}"`);
    if (!churchNorm) flags.push("church unresolvable — needs manual assignment");
    if (!whatsApp1) flags.push("no phone/WhatsApp number");
    if (whatsApp2) flags.push(`second phone number captured: ${whatsApp2}`);
    if (!resourceType && r["OTHER SUBSCRIPTION"])
        flags.push(`resource type unmapped: "${r["OTHER SUBSCRIPTION"]}"`);

    if (flags.length > 0) {
        flagged.push({ rowNum, itemName, flags, source: r, record });
    }

    cleaned.push(record);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Transform Summary ────────────────────────────────────────`);
console.log(`  Total rows processed : ${rows.length}`);
console.log(`  Records to import    : ${cleaned.length}`);
console.log(`  Rows with flags      : ${flagged.length}`);
console.log(`  Rows skipped (empty) : ${rows.length - cleaned.length - flagged.filter(f => !f.record).length}`);

// Church match stats
const churchMissed = cleaned.filter(r => !normaliseChurch(r._rawChurch).matched).length;
const churchEvent = cleaned.filter(r => normaliseChurch(r._rawChurch).isEvent).length;
const churchNull = cleaned.filter(r => !normaliseChurch(r._rawChurch).canonical).length;
console.log(`\n  Church name stats:`);
console.log(`    Not in norm map  : ${churchMissed}`);
console.log(`    Event names      : ${churchEvent}`);
console.log(`    Unresolvable     : ${churchNull}`);

// Resource type stats
const noResource = cleaned.filter(r => !r[PEOPLE_COLS.resourceType]).length;
console.log(`\n  Resource type stats:`);
console.log(`    Missing/unmapped : ${noResource}`);

if (SHOW_FLAGGED && flagged.length > 0) {
    console.log(`\n── Flagged Rows ─────────────────────────────────────────────`);
    flagged.forEach(({ rowNum, itemName, flags, reason }) => {
        console.log(`  Row ${rowNum}: "${itemName || "(no name)"}"`);
        if (reason) console.log(`    ⚠  ${reason}`);
        (flags || []).forEach(f => console.log(`    ⚠  ${f}`));
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
