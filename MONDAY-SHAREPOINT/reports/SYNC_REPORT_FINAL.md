# Language Profile Migration Report
## Monday.com → SharePoint Active Projects

**Prepared by:** Edwin Brooks  
**Date:** January 31, 2026  
**Status:** ✅ Complete

---

## Executive Summary

Successfully migrated **280 Language Profile files** from the Monday.com Partner Projects board to SharePoint Active Projects site. All ACTIVE projects with valid Language Profile documents have been synced. Each file was placed in an UPPERCASE folder matching the Partner Project Name, with MOU End Date metadata applied where available.

---

## Migration Results

| Metric | Count |
|--------|------:|
| Language Profiles Uploaded | 280 |
| New Folders Created | 273 |
| MOU End Dates Applied | 271 |
| Upload Errors | 0 |

**Duration:** ~58 minutes  
**Destination:** `https://seedcompany.sharepoint.com/sites/ActiveProjects/`

---

## Data Analysis

| Category | Count | Notes |
|----------|------:|-------|
| Total ACTIVE items in Monday.com | 427 | Items with Lang Status = "ACTIVE" |
| With valid Language Profile | 280 | Successfully migrated |
| With broken file reference | 13 | File metadata exists but asset is missing |
| Without Language Profile | 134 | No file in Language Profile column |

---

## Items Requiring Attention

The following 13 ACTIVE projects have a file reference in the Language Profile column, but the actual file cannot be accessed. These may need the Language Profile re-uploaded in Monday.com:

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


## Recommendations

1. **Review the 13 items** with broken file references and re-upload their Language Profiles in Monday.com if needed
2. **Verify sample folders** in SharePoint to confirm files are accessible
3. **Consider automation** for future uploads via n8n webhook integration

---

*Report generated from sync operation completed January 30-31, 2026*
