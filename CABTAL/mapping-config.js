/**
 * CABTAL Data Transformation — Mapping Configuration
 *
 * Central reference for:
 *   1. Board IDs
 *   2. People board column IDs → XLSX source fields
 *   3. Gifts board column IDs
 *   4. Church name normalisation (messy XLSX value → canonical org name)
 *   5. Resource-type normalisation (OTHER SUBSCRIPTION → dropdown label)
 *
 * Edit this file when column IDs change or new church names need mapping.
 * All transform/import scripts import from here — never hardcode IDs elsewhere.
 */

// ── Board IDs ─────────────────────────────────────────────────────────────────
const BOARDS = {
    people: 18400425732,  // Future CABTAL RM People (Donors)
    peopleSubitems: 18400425739,  // Subitems of Future CABTAL RM People (Donors)
    orgs: 18400425898,  // Future of CABTAL RM Organizations
    orgsSubitems: 18400425905,  // Subitems of Future of CABTAL RM Organizations
    gifts: 18400426079,  // Future of CABTAL RM GIFTS
    // Legacy (source for connect_boards on gifts board — see GIFTS.connect_boards)
    peopleLegacy: 18231902551,
};

// ── People board — target group for XLSX imports ──────────────────────────────
const PEOPLE_IMPORT_GROUP = "group_mkwyx3kv"; // "DCSE_CRM_RM_DATABASE"

// ── People board column IDs ───────────────────────────────────────────────────
// Confirmed from: node explore-boards.js (2025-02-24)
const PEOPLE_COLS = {
    name: "name",              // item name (full NAME + tel, unique id)
    lastName: "dup__of_first_name",// Last Name (text)
    firstName: "text7",             // First Name (text)
    title: "dropdown2",         // Title (dropdown)
    middleName: "text_mkwgmwbn",     // Middle Name (text)
    director: "multiple_person_mkzth1sb", // Director (people)
    coordinator: "multiple_person_mkztfskv", // Coordinator (people)
    comms: "multiple_person_mkztk4c1",  // Comms (people)
    whatsApp: "phone3",            // WhatsApp (phone) — main phone field
    email: "email",             // Contact Email
    churchNameRaw: "text_mkzt1rkb",    // Church Name (free text; raw from source)
    churchNameNorm: "text_mkztnmd",     // Real Church Name (normalised canonical)
    location: "location",          // Location (location)
    partnerType: "status_1",          // Partner Type: "Church"|"Individual"
    resourceType: "dropdown_mkzt91c4", // Resource Type: Prayer|Financial|Volunteer|Member
    events: "dropdown_mky152kd", // Events dropdown
    donorLevel: "color_mkx5qj4y",   // Donor Level status
    pledgeAmt: "numbers",           // Pledge Amt (numbers, Franc XFA)
    pledgeDate: "date_mkztjb29",     // Pledge Submitted Date
    firstDonationDate: "date_mm00rec4",     // Date of 1st Donation
    frequency: "dropdown_mkzttn4a", // Frequency: Monthly|Quarterly|Yearly|One Time
    firstContactDate: "date4",             // First Contact Date
    newsletter: "status",            // Newsletter Subscription: YES|NO
    birthday: "date",              // Birthday
    pointsOfInterest: "long_text1",        // Points of Interest
    motherTongue: "text_mkztwsc5",     // Mother Tongue
    // Read-only / auto:
    itemId: "pulse_id_mktqngky", // Item ID (auto)
    totalGifts: "lookup_mkztnfsc",   // Total Gift Amount (mirror, read-only)
};

// ── Gifts board column IDs ────────────────────────────────────────────────────
const GIFTS_COLS = {
    name: "name",            // item name (donor name, for display)
    date: "date4",           // Date (date)
    amount: "numbers",         // Donation Amount (numbers, CFA)
    usdEquiv: "formula",         // USD Equivalent (formula, read-only)
    inKind: "text",            // In Kind Gift (text)
    status: "status__1",       // Status: "Pledged Gift"|"Reoccuring Gift"|"One Time Gift"
    donorLink: "board_relation_mm1hvazm",  // Donor (board_relation → Future People 18400425732)
    campaign: "dropdown_mkwyyhph", // RM Campaign dropdown
};

// ── Gifts board — group IDs ───────────────────────────────────────────────────
const GIFTS_GROUPS = {
    financeIntake: "new_group__1",    // Finance System Intake
    pledged: "new_group75363",  // Pledged Gifts
    oneTime: "new_group",       // One Time Gifts
};

// ── Church name normalisation ─────────────────────────────────────────────────
// Maps every messy XLSX CHURCH value (lowercased + trimmed for comparison) to
// the canonical organisation name as it appears on the Organizations board.
// Values that start with "Annual Report" are event names, not churches → null.
// Values set to null will be flagged as unmatched in the review report.
const CHURCH_NORM = {
    // ── case / typo variants of known churches ──────────────────────────────
    "eec messamendongo": "EEC Messamendongo",
    "eec messamendongo ": "EEC Messamendongo",
    "eec messamendongo  ": "EEC Messamendongo",
    "eec messama II": "EEC Messamendongo",
    "ecc nkoabang": "EEC NKOABANG",   // ECC → EEC (typo)
    "eec nkoabang": "EEC NKOABANG",
    "fgm mvog enygue": "FGM MVOG ENYEGUE",  // typo
    "mpe bepelle": "MPE BEPELE",         // typo
    "mpe ndogpassi 1": "MPE NDOGPASSI",
    "tacc ndogpassi": "TAC NDOGPASSI",  // TACC → TAC (check org board name)
    "rccg biyem-assi": "RCCG BIYEMASSI",
    "rccg etougebe": "RCCG ETOUGEBE",
    // ── abbreviations ────────────────────────────────────────────────────────
    "epc": "EPC TOHI",   // ambiguous — flag for review if > 1 EPC
    "mpe": null,          // too ambiguous — needs manual resolution
    "fgbi": "FGBI",
    "adv": null,          // not in org board — flag
    "catho": "CATHO",
    // ── event names (not churches) ───────────────────────────────────────────
    "annual report launch maroua": null,
    "annual report launch maroua ": null,
    "annual report luanch maroua": null,
    "annual report lauch maroua": null,  // without trailing space
    "annual report lauch maroua ": null,  // with trailing space
    "annual report launch yde": null,
    // ── direct matches (add more as discovered) ──────────────────────────────
    "cbc atwakun": "CBC Atwakun",
    "cbc mfou": "CBC MFOU",
    "cbc nkwen": "CBC NKWEN",
    "eec nkomo": "EEC NKOMO",
    "eec nkolndongo 1": "EEC NKOLNDONGO 1",
    "eec nkozoa": "EEC NKOZOA",
    "emec etougebe": "EMEC ETOUGEBE",
    "emec malabo": "EMEC MALABO",
    "epc tohi": "EPC TOHI",
    "faith baptist church anguissa": "FAITH BAPTIST CHURCH ANGUISSA",
    "fgm biyemassi": "FGM BIYEMASSI",
    "fgm eleveur": "FGM ELEVEUR",
    "fgm emombo": "FGM EMOMBO",
    "fgm jubilee": "FGM Jubilee",
    "fgm mvog enyegue": "FGM MVOG ENYEGUE",
    "fgm ndogpassi": "FGM NDOGPASSI",
    "fgm nsimeyong ii": "FGM NSIMEYONG II",
    "fgm savana": "FGM SAVANA",
    "messama ii": "MESSAMA II",
    "mpe bepele": "MPE BEPELE",
    "mpe japoma d'la": "MPE JAPOMA D'LA",
    "mpe mahol city": "MPE MAHOL CITY",
    "mpe ndogpassi": "MPE NDOGPASSI",
    "mpe ngo njoh": "MPE NGO NJOH",
    "mpe ngodi": "MPE NGODI",
    "mpe omnisport": "MPE OMNISPORT",
    "rccg biyemassi": "RCCG BIYEMASSI",
    "rccg etougebe": "RCCG ETOUGEBE",
    "tac essos": "TAC ESSOS",
    "tac mbankolo": "TAC MBANKOLO",
    "tac mimboman": "TAC MIMBOMAN",
    "tac ndogpassi": "TAC NDOGPASSI",
    "tac nsimeyong": "TAC NSIMEYONG",
    "tac omnisport": "TAC OMNISPORT",
    "ueec ekie": "UEEC EKIE",
    "vie profonde emana": "VIE PROFONDE EMANA",
    "apostolic church": "APOSTOLIC CHURCH",
};

/**
 * Normalise a raw CHURCH cell value.
 * Returns { canonical, matched, isEvent } where:
 *   canonical  — the canonical org name (string) or null if unresolvable
 *   matched    — true if found in CHURCH_NORM map
 *   isEvent    — true if the value looks like an event, not a church name
 */
function normaliseChurch(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw || raw === " ") return { canonical: null, matched: false, isEvent: false };

    const key = raw.toLowerCase().trim();

    if (key in CHURCH_NORM) {
        const canonical = CHURCH_NORM[key];
        const isEvent = /^annual report/i.test(raw);
        return { canonical, matched: true, isEvent };
    }

    // Not in map — return as-is, flagged
    return { canonical: raw, matched: false, isEvent: false };
}

// ── Resource type normalisation ───────────────────────────────────────────────
// Maps XLSX "OTHER SUBSCRIPTION" values to People board Resource Type dropdown labels.
// Dropdown IDs: 1=Prayer, 2=Financial, 3=Volunteer, 4=Member
const RESOURCE_TYPE_MAP = {
    "prayer partner": "Prayer",
    "prayer": "Prayer",
    "prayer ": "Prayer",
    "prayeer partner": "Prayer",   // typo
    "rayer partner": "Prayer",   // typo
    "member/prayer partner": "Prayer",   // combined — default to Prayer
    "member/ prayer partner": "Prayer",   // combined with space
    "financial": "Financial",
    "member": "Member",
    "membership": "Member",
    "volunteer": "Volunteer",
};

function normaliseResourceType(raw) {
    if (!raw || raw.toString().trim() === "") return null;
    return RESOURCE_TYPE_MAP[raw.toString().trim().toLowerCase()] || null;
}

// ── Gift status mapping ───────────────────────────────────────────────────────
// Maps frequency/sheet name to Gifts board Status dropdown label
const GIFT_STATUS_MAP = {
    "monthly": "Reoccuring Gift",
    "quarterly": "Reoccuring Gift",
    "yearly": "Reoccuring Gift",
    "one time": "One Time Gift",
    "one-time": "One Time Gift",
};

function normaliseGiftStatus(frequency) {
    if (!frequency) return "One Time Gift";
    return GIFT_STATUS_MAP[frequency.toString().trim().toLowerCase()] || "One Time Gift";
}

// ── Phone normalisation ───────────────────────────────────────────────────────
/**
 * Cleans phone numbers from source:
 *   - Removes spaces, dashes, parentheses
 *   - Handles comma/semicolon/slash-separated multiple numbers
 * Returns an array of clean phone strings (up to 2).
 */
function normalisePhone(raw) {
    if (!raw && raw !== 0) return [];
    const str = String(raw).trim();
    if (!str) return [];

    const toCountryCode = (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";

        const hasPlus = trimmed.startsWith("+");
        let digits = trimmed.replace(/\D+/g, "");
        if (!digits) return "";

        if (hasPlus) return `+${digits}`;
        if (digits.startsWith("00") && digits.length > 4) return `+${digits.slice(2)}`;

        // Cameroon local format (9 digits) -> +237XXXXXXXXX
        if (digits.length === 9) return `+237${digits}`;

        // Cameroon already has country code without +
        if (digits.startsWith("237") && digits.length === 12) return `+${digits}`;

        // Keep unknown international numbers as E.164-like +digits
        if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;

        return "";
    };

    // Split on separators that indicate multiple numbers
    const parts = str.split(/[\s]*[,;\/][\s]*/).map((p) =>
        toCountryCode(p)
    ).filter(Boolean);

    // If no separator, clean the single value
    if (parts.length === 0) {
        const clean = toCountryCode(str);
        return clean ? [clean] : [];
    }

    return parts.slice(0, 2); // max 2
}

// ── Name splitting ────────────────────────────────────────────────────────────
/**
 * Splits a full NAME into { firstName, middleName, lastName }.
 * Assumption: last token = last name (African naming convention is LASTNAME FIRSTNAME).
 * However XLSX data is mixed — some rows are LASTNAME FIRSTNAME, others FIRSTNAME LASTNAME.
 * Heuristic: if name is ALL-CAPS it's likely stored as LASTNAME FIRSTNAME.
 * Returns { firstName, lastName, middleNames, flagForReview } where
 *   flagForReview = true when the name has > 3 tokens (ambiguous split).
 */
function splitName(raw) {
    const str = String(raw || "").trim();
    const tokens = str.split(/\s+/).filter(Boolean);

    if (tokens.length === 0) return { firstName: "", lastName: "", middleNames: "", flagForReview: false };
    if (tokens.length === 1) return { firstName: tokens[0], lastName: "", middleNames: "", flagForReview: false };

    // All-caps names: stored as LASTNAME FIRSTNAME [MIDDLENAME...]
    const isAllCaps = str === str.toUpperCase();

    let lastName, firstName, middleNames;
    if (isAllCaps) {
        // FAMILY GIVEN [MIDDLE...]
        [lastName, firstName, ...middleNames] = tokens;
    } else {
        // Mixed case: treat first token as first name, last as last name
        [firstName, ...middleNames] = tokens;
        lastName = middleNames.pop() || "";
    }

    return {
        firstName: firstName || "",
        lastName: lastName || "",
        middleNames: middleNames.join(" "),
        flagForReview: tokens.length > 3,
    };
}

function inferPartnerType(rawName) {
    const value = String(rawName || "").trim();
    if (!value) return "Individual";
    if (/\b(church|ministry|ministries|fellowship|mission|chapel|parish|assembly|diocese|union|association)\b/i.test(value)) {
        return "Church";
    }
    return "Individual";
}

// ── Date normalisation ────────────────────────────────────────────────────────
/**
 * Converts various date formats from the XLSX to ISO YYYY-MM-DD strings.
 * Handles: JS Date objects, ISO strings, "DD/MM/YYYY" strings.
 */
function normaliseDate(raw) {
    if (!raw || raw === "") return null;
    if (raw instanceof Date) {
        return raw.toISOString().split("T")[0];
    }
    const str = String(raw).trim();
    // Already ISO-ish
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
    // Full ISO string from XLSX
    if (str.includes("T")) {
        try { return new Date(str).toISOString().split("T")[0]; } catch (_) { }
    }
    // DD/MM/YYYY
    const ddmm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
    // Long JS Date string (from cellDates: true)
    if (/\w+ \w+ \d+ \d{4}/.test(str)) {
        try { return new Date(str).toISOString().split("T")[0]; } catch (_) { }
    }
    return null;
}

module.exports = {
    BOARDS,
    PEOPLE_IMPORT_GROUP,
    PEOPLE_COLS,
    GIFTS_COLS,
    GIFTS_GROUPS,
    CHURCH_NORM,
    RESOURCE_TYPE_MAP,
    GIFT_STATUS_MAP,
    normaliseChurch,
    normaliseResourceType,
    normaliseGiftStatus,
    normalisePhone,
    splitName,
    inferPartnerType,
    normaliseDate,
};
