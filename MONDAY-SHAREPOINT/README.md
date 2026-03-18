# Monday.com to SharePoint Migration - Dry Test

This script tests the migration pipeline by processing exactly **ONE file** from Monday.com board to SharePoint.

## 🎯 Purpose

Validates the complete migration workflow:
- ✅ Monday.com API authentication and data retrieval
- ✅ Column resolution by title (not hardcoded IDs)
- ✅ File download from Monday.com
- ✅ Microsoft Graph authentication (client credentials)
- ✅ SharePoint site/drive resolution
- ✅ File upload to SharePoint

## 📋 Prerequisites

- Python 3.11+
- Monday.com API token
- Azure AD App Registration with:
  - Client ID and Client Secret
  - API Permissions: `Sites.ReadWrite.All` (Application permission)
  - Admin consent granted

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

Or export them directly:

```bash
export MONDAY_API_TOKEN="your_monday_token"
export TENANT_ID="your_tenant_id"
export CLIENT_ID="your_client_id"
export CLIENT_SECRET="your_client_secret"
```

### 3. Run Dry Test (Download Only)

```bash
python monday_to_sharepoint_drytest_onefile.py
```

This will:
- Find the first valid item with a file
- Download ONE file to `./downloads/_drytest/<project_name>/`
- Show what would be uploaded (but won't upload)

### 4. Test Upload

```bash
python monday_to_sharepoint_drytest_onefile.py --upload
```

This uploads the file to SharePoint test folder: `Projects/_TEST_MondayUpload/`

## 📝 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONDAY_API_TOKEN` | ✅ Yes | - | Monday.com API token |
| `TENANT_ID` | ✅ Yes | - | Azure AD tenant ID |
| `CLIENT_ID` | ✅ Yes | - | Azure AD app client ID |
| `CLIENT_SECRET` | ✅ Yes | - | Azure AD app client secret |
| `SHAREPOINT_HOSTNAME` | No | `seedcompany.sharepoint.com` | SharePoint hostname |
| `SHAREPOINT_SITE_PATH` | No | `/sites/ActiveProjects` | SharePoint site path |
| `TEST_UPLOAD_FOLDER` | No | `Projects/_TEST_MondayUpload` | Test upload folder path |

### Monday.com Board

- **Board ID**: `8445103301`
- **Board URL**: https://seed-company-squad.monday.com/boards/8445103301
- **File Column**: "Language Profil"
- **Project Column**: "Project Partner Name"

## 🎮 Command-Line Options

```bash
# Dry run (default) - download only, no upload
python monday_to_sharepoint_drytest_onefile.py

# Upload mode - actually upload to SharePoint
python monday_to_sharepoint_drytest_onefile.py --upload

# Force re-download even if file exists locally
python monday_to_sharepoint_drytest_onefile.py --force

# Both flags together
python monday_to_sharepoint_drytest_onefile.py --upload --force
```

## 📂 File Structure

```
.
├── monday_to_sharepoint_drytest_onefile.py  # Main script
├── requirements.txt                          # Python dependencies
├── .env.example                              # Environment variables template
├── .env                                      # Your credentials (git-ignored)
└── downloads/                                # Downloaded files
    └── _drytest/
        └── <project_name>/
            └── <filename>
```

## 🔐 Azure AD App Setup

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Create new registration or use existing app
3. Note the **Application (client) ID** and **Directory (tenant) ID**
4. Create a **Client Secret** under Certificates & secrets
5. Add API permissions:
   - Microsoft Graph → Application permissions → `Sites.ReadWrite.All`
6. **Grant admin consent** for the permissions

## 🐛 Troubleshooting

### "Missing required environment variables"
- Ensure all required env vars are set
- Check for typos in variable names

### "Board not found" or "Column not found"
- Verify Monday.com API token has access to board 8445103301
- Check column titles match exactly: "Language Profil" and "Project Partner Name"

### Microsoft Graph authentication errors
- Verify tenant ID, client ID, and client secret are correct
- Ensure API permissions are granted and admin consent is provided
- Check that the app has `Sites.ReadWrite.All` permission

### "No valid items found"
- Ensure at least one item has both:
  - A non-empty "Project Partner Name"
  - At least one file in "Language Profil" column

## 📊 What Success Looks Like

```
======================================================================
🧪 MONDAY → SHAREPOINT DRY TEST (ONE FILE)
======================================================================

✓ Configuration loaded
  • Monday Board: 8445103301
  • SharePoint Site: seedcompany.sharepoint.com/sites/ActiveProjects
  • Test Upload Folder: Projects/_TEST_MondayUpload

🔍 Step 1: Resolving Monday columns...
   • 'Language Profil' → files_column_123
   • 'Project Partner Name' → text_column_456

📥 Step 2: Fetching Monday board items...
   ✓ Retrieved 25 items

🎯 Step 3: Finding first valid item with file...
   ✓ Found valid item:
     • Item: Example Project
     • Project: Acme Corporation
     • File: language_profile.pdf

⬇️  Step 4: Downloading file...
   ✓ Downloaded 1,234,567 bytes

⬆️  Step 5: Uploading to SharePoint...
   ✓ Access token obtained
   ✓ Site ID: contoso.sharepoint.com,abc123,def456
   ✓ Drive ID: b!xyz789
   ✓ File uploaded successfully!

======================================================================
✅ DRY TEST COMPLETED SUCCESSFULLY
======================================================================
```

## 🔄 Next Steps

After successful dry test:
1. ✅ Confirm file appears in SharePoint at `Projects/_TEST_MondayUpload/`
2. ✅ Verify file content is correct and not corrupted
3. ✅ Check permissions on uploaded file
4. 🚀 Ready to build full migration script for all files

## 📞 Support

For issues or questions, refer to:
- [Monday.com API Documentation](https://developer.monday.com/api-reference/docs)
- [Microsoft Graph API Documentation](https://learn.microsoft.com/en-us/graph/api/overview)
