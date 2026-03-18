# TWFTW SCBTF Reports — Q1 2026 Import Report

**Date:** March 18, 2026
**Report Period:** Q1 2026 (January – March 2026)
**Prepared by:** Edwin Brooks
**Status:** Complete

---

## Summary

| Metric | Count |
|--------|------:|
| Reports received from TWFTW | 199 |
| Matched to existing language records | 170 |
| New languages added | 29 |
| Financial reports uploaded | 199 |
| Narrative reports uploaded | 198 |
| Testimonials imported | 198 |
| Date-stamped (2026-03-18) | 198 |
| Errors | 1 (Nyika — NAR PDF download failed) |

198 of 199 reports were fully processed. Nyika (nkv) had a network failure downloading its narrative PDF from S3; the financial report uploaded successfully.

---

## What Was Updated

Q1 2026 reports were pulled from the TWFTW ERA system and uploaded to the Dev TranTrak board on Monday.com. This quarter also introduced per-quarter storage of community testimonials alongside the financial and narrative reports, giving the board a full record of each language's quarterly submission going forward.

---

## New Languages Added (29)

These languages submitted Q1 2026 reports for the first time and were added as new records on the board.

| Language | ISO |
|----------|-----|
| Gavi | vaa |
| Komi | nit |
| Lire | rei |
| Khatei | kfw |
| Unda | dnv |
| Weida | tvn |
| Maptun | crw |
| Nyiha | nih |
| Timbaro | tir |
| Rage | rge |
| Kibingi | kiu |
| Chiyeyi | yey |
| Subia | sbs |
| Korekore | kre |
| Kalanga | kck |
| Kinyemikebwe | cgg |
| Bamwe Lifonga | bmq |
| Bamwe Likata | bmq |
| Kikumu-katoyi | hke |
| Kinyamatcha | hke |
| Kihutu | kin |
| Kinyajomba | kin |
| Kinyarugari | kin |
| Kisanza | kin |
| Sukwa | swk |
| Donga | dga |
| Lutiabwa | nyo |
| Chifwe | her |
| Kasenga | cgg |

---

## Issues Found & Resolved

### Duplicate Files on Some Language Records

**Discovered:** March 18, 2026

**Background:** Each language in the TWFTW system carries two identifiers — a standard three-letter language code and a unique dialect number. Language codes are assigned to broad language varieties and are shared across dialects; the dialect number is assigned per translation project and is always unique.

**Problem:** The initial import used the language code as its matching key. Because many distinct translation projects share the same language code, they could not be told apart. Both reports in a shared-code pair were filed under whichever record came up first, leaving the other with no files and — in some cases — causing the wrong report to appear under a language's name entirely.

**Scale:** 16 groups of languages were affected, covering 36 languages in total — 18% of all reports in this quarter. Three language codes were shared by three or more projects:

| Language Code | Languages |
|---|---|
| Bamwe group | Bamwe Libobi, Bamwe Lifonga, Bamwe Likata |
| Hunde group | Kihunde-bwito, Kikumu-katoyi, Kinyamatcha |
| Kinyarwanda group | Kihutu, Kinyajomba, Kinyarugari, Kisanza |

Other affected pairs included Gavi/Hapi, Langching/Chou, Bandya/Sukwa, Chifwe/Chiyeyi, Mbalangwe/Subia, Buja/Korekore, Jahunda/Kalanga, Donga/Timbaro, Kasenga/Kinyemikebwe, Kibingi/Runyabutumbi, Lutiabwa/Rukibiro, Macedonian Arli Romani/Arli, and Chergash/Gurbet.

**Resolution:** The import was corrected to use the unique dialect number for matching. All 199 records were re-processed and now have the correct files attached.

**Outstanding item:** Two records on the board — Nila and Priya — share both a language code and a dialect number, suggesting a data entry error when they were originally created. The source data should be reviewed to assign each a distinct dialect number.

### Missing: Shifwe (fwe)

**Discovered:** March 18, 2026

**Problem:** Shifwe (ISO `fwe`) does not appear anywhere in the 199 reports returned by the ERA API for Q1 2026. No record with language name "Shifwe" or ISO code `fwe` was included in the data pull. The language either did not submit a report this quarter, or is registered under a different name/code in the ERA system.

**Action needed:** Confirm with TWFTW whether Shifwe (fwe) submitted a Q1 2026 report and, if so, what name and language code it is filed under in the ERA system.

### Error: Nyika (nkv)

**Discovered:** March 18, 2026

**Problem:** The financial report (Excel) uploaded successfully, but the narrative report (PDF) failed to download from S3 with a network error (`fetch failed`). Testimonials were also skipped as a result.

**Action needed:** Re-run the import for this single item, or manually upload the PDF.

---

*Import completed: March 18, 2026*
