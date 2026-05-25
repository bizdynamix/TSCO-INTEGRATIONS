# Monday.com to SharePoint Migration Report

**Date:** January 17, 2026 — January 31, 2026
**Migration Type:** Language Profile Files — Bulk Migration + Full Sync
**Prepared by:** Edwin Brooks

---

## Executive Summary

Completed full migration of Language Profile documents from Monday.com to SharePoint Active Projects site across two phases. Phase 1 (January 17) was an initial bulk migration of 100 projects. Phase 2 (January 30–31) expanded coverage to all 427 ACTIVE projects, uploading 280 Language Profile files in total.

---

## Final Migration Statistics

| Metric | Phase 1 (Jan 17) | Phase 2 (Jan 30–31) | Final Total |
|--------|:---:|:---:|:---:|
| Projects Processed | 100 | 427 | 427 |
| Files Uploaded | 97 | 280 | 280 |
| Folders Created | 70 | 273 | 273 |
| MOU End Dates Set | 70 | 271 | 271 |
| Files Skipped (already existed) | 2 | — | — |
| Upload Errors | 3 | 0 | 0 |
| Duration | ~3 min | ~58 min | — |

**Final Success Rate: 100%** (all accessible files uploaded)

---

## Source & Destination

**Source**
- Platform: Monday.com
- Workspace: Multiplication Language Space
- Board: Partner Projects (ID: `8445103301`)
- Column: Language Profile (`files0`)

**Destination**
- Platform: SharePoint Online
- Site: `seedcompany.sharepoint.com/sites/ActiveProjects`
- Structure: `{PROJECT_NAME}/` folders at root of Active Projects document library
- Naming Convention: All folder names converted to UPPERCASE

---

## Phase 1 — Initial Bulk Migration (January 17, 2026)

Initial run against 100 projects. Resulted in 3 errors requiring follow-up:

| # | Project | Issue | Resolution |
|---|---------|-------|------------|
| 1 | Lutiabwa - Albertine Cluster? | `?` character invalid in SharePoint folder name | Resolved in Phase 2 |
| 2 | KAISANDOSA CLUSTER 2 | Folder created in `/Projects/` subfolder instead of root | Resolved — folders moved to correct location |
| 3 | NORTH KIVU CLUSTER | Same incorrect path as above | Resolved — folders moved to correct location |

---

## Phase 2 — Full Sync (January 30–31, 2026)

Expanded run across all 427 ACTIVE projects. Uploaded all valid Language Profile files not already present in SharePoint. Aromanian Frasherot initially failed with a 400 error; resolved via `fix_aromanian.py` and successfully uploaded.

### Monday.com Data Analysis

| Category | Count |
|----------|------:|
| Total ACTIVE items | 427 |
| With valid Language Profile | 280 |
| With broken file reference (asset missing) | 13 |
| Without Language Profile | 134 |

---

## Items Requiring Attention

The following 13 ACTIVE projects have a file reference in the Language Profile column but the underlying asset cannot be accessed. Language Profiles need to be re-uploaded in Monday.com for these items:

| Item Name | Partner Project Name | Monday Item ID |
|-----------|---------------------|----------------|
| Mbeere | Mbeere | 8796544000 |
| Borna | Boraw Cluster | 8796544055 |
| Yemsa | Hayem Cluster | 8796544149 |
| Bodi-Me'en | Bodi-Me'en | 8796544002 |
| Terik | Teregoti | 8796544160 |
| Nayi | Nayi | 8796544032 |
| Banna | Babur Cluster | 8796544171 |
| Burji | Babur Cluster | 8796543996 |
| Sheko | Sheko | 8796544082 |
| Halaba | Hayem Cluster | 8796544035 |
| Awngi | Boraw Cluster | 8796544278 |
| Basketo | Basketo | 8796544224 |
| Kachame - Ganjule: Gats'ame | Kahama - Ganjule: Gats'ame | 8796547220 |

---

## Technical Details

### Process Flow
1. Extracted project data from Monday.com via GraphQL API (column IDs resolved dynamically by title)
2. Downloaded Language Profile files to local staging (`./downloads/_bulk/`)
3. Authenticated with Microsoft Graph API using Azure AD client credentials
4. Created UPPERCASE project folders in SharePoint (if not existing)
5. Set MOU End Date metadata on newly created folders
6. Uploaded files; skipped files already present (idempotent)

### Column Mapping

| Field | Monday Column | Internal ID |
|-------|--------------|-------------|
| Files | Language Profile | `files0` |
| Project Name | Partner Project Name | `project_mkm1qfap` |
| MOU End Date | MOU End | `date_2` |

### SharePoint Metadata

| Field | Value |
|-------|-------|
| Column Name | MOU End Date |
| Internal Name | `MOUenddate0` |
| Type | Date (`dateOnly`) |
| Applied to | Newly created folders only (273 folders) |

### Reliability Measures

| Risk | Mitigation | Status |
|------|-----------|--------|
| API rate limiting | 0.5s delays (SharePoint), 0.3s (Monday) | ✅ |
| File overwrites | Existence check before every upload | ✅ No overwrites |
| Network failures | 1s recovery delay after errors | ✅ |
| Data loss | Files staged locally before upload | ✅ Backed up |
| Duplicate runs | Idempotent — skips existing files | ✅ Verified |
| Invalid characters | SharePoint naming validation | ✅ Resolved |

---

## Script Architecture

| Script | Purpose |
|--------|---------|
| `bulk_migrate_all.py` | Phase 1 bulk migration (100 projects) |
| `sync_missing_profiles.py` | Phase 2 full sync (all 427 ACTIVE projects) |
| `fix_aromanian.py` | Targeted fix for Aromanian Frasherot upload error |
| `create_audit_sheet.py` | Generates audit Excel (`Language_Profile_Audit_20260131.xlsx`) |
| `compare_monday_sharepoint.py` | Compares Monday vs SharePoint state |
| `audit_monday_sharepoint.py` | Full audit script |
| `rename_folders_uppercase.py` | Standardises folder names to UPPERCASE |

**Audit File:** `Language_Profile_Audit_20260131.xlsx` (generated January 31, 2026)

---

## Credentials & Access

- **Azure AD App:** Client credentials flow (`Sites.ReadWrite.All`)
- **Monday API:** Personal access token (read access)
- **Credentials:** Stored in `.env` (not committed to repository)
- **Script Location:** `/Users/edwinbrooks/Projects/MONDAY-SHAREPOINT/`

---

## Recommendations

### Immediate
- Re-upload Language Profiles for the 13 items with broken file references in Monday.com, then re-run `sync_missing_profiles.py` to pick them up automatically

### Short-term
- Implement n8n webhook to automatically sync new Language Profile uploads from Monday.com to SharePoint going forward (eliminates manual re-runs)
- Notify project teams that Language Profiles are now the authoritative copy in SharePoint

### Long-term
- Quarterly audit using `compare_monday_sharepoint.py` to catch any drift
- Review whether Monday.com should remain source of truth for these files or be deprecated in favour of SharePoint

---

*Last updated: January 31, 2026*
