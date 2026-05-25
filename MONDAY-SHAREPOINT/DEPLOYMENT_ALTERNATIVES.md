# Alternative Deployment Options

This document outlines alternative ways to deploy the Monday Language Profile sync, for future reference.

---

## Current Approach (Active) ✅

**Monday Code Automation Action**

```
Monday Vibe Automation 
  → POST https://a7673-service-12597801-ef203e65.us.monday.app/monday/action
  → Flask server runs webhook_handler.py on Monday Code
  → Syncs to SharePoint immediately
```

**Advantages:**
- ✅ Fastest response (~1-2 seconds)
- ✅ Simple, single endpoint from the Automations builder
- ✅ Direct control, no cloud overhead
- ✅ Code version controlled in Git
- ✅ Already deployed and tested

**Status:** ACTIVE — Ready for production

---

## Alternative 1: GitHub Actions Workflow

Store sync code in GitHub and trigger via GitHub Actions.

**Architecture:**
```
Monday Automation 
  → POST to GitHub API (repository_dispatch)
  → Triggers GitHub Actions workflow
  → Runs webhook_handler.py
  → Syncs to SharePoint
```

**Webhook URL for Monday:**
```
POST https://api.github.com/repos/SEEDCOMPANY/MONDAY-SHAREPOINT/dispatches

Body:
{
  "event_type": "sync_language_profile",
  "client_payload": {
    "item_id": {item_id},
    "project_name": {item.name},
    ...
  }
}
```

**GitHub Workflow File:**
```yaml
# .github/workflows/sync-language-profile.yml
name: Sync Language Profile to SharePoint

on:
  repository_dispatch:
    types: [sync_language_profile]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install -r MONDAY-SHAREPOINT/requirements.txt
      
      - name: Run sync handler
        run: python MONDAY-SHAREPOINT/webhook_handler.py
        env:
          MONDAY_API_TOKEN: ${{ secrets.MONDAY_API_TOKEN }}
          TENANT_ID: ${{ secrets.TENANT_ID }}
          CLIENT_ID: ${{ secrets.CLIENT_ID }}
          CLIENT_SECRET: ${{ secrets.CLIENT_SECRET }}
          GITHUB_PAYLOAD: ${{ toJson(github.event.client_payload) }}
      
      - name: Log results
        if: always()
        run: echo "Sync workflow completed"
```

**Advantages:**
- Serverless (no VPS to maintain)
- Code runs in GitHub infrastructure
- Native Git integration
- Free tier (3000 minutes/month)
- Automatic scaling

**Disadvantages:**
- Slower response (~30-60s for cold start)
- GitHub API rate limits
- Complex authentication setup
- Actions logs less detailed than syslog
- Overkill for simple webhook

**Status:** NOT RECOMMENDED — Use if VPS becomes unavailable

---

## Alternative 2: AWS Lambda

Deploy webhook_handler.py as AWS Lambda function triggered by API Gateway.

**Architecture:**
```
Monday Automation 
  → POST to API Gateway
  → Triggers Lambda function
  → Runs webhook_handler.py
  → Syncs to SharePoint
```

**Webhook URL for Monday:**
```
POST https://{api-gateway-id}.execute-api.us-east-1.amazonaws.com/dev/sync-language-profile
```

**Lambda Function Setup:**
```python
# lambda_function.py
import json
from webhook_handler import sync_language_profile

def lambda_handler(event, context):
    """AWS Lambda handler for Language Profile sync."""
    try:
        body = json.loads(event.get('body', '{}'))
        result = sync_language_profile(body)
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
```

**Advantages:**
- Fully serverless
- Pay-per-execution (~$0.20/million invocations)
- Auto-scaling
- AWS ecosystem integration
- No VPS management

**Disadvantages:**
- Cold start latency (~3-5 seconds)
- IAM permission complexity
- Requires AWS account
- More expensive at high volume

**Status:** NOT RECOMMENDED — Over-engineered for this use case

---

## Alternative 3: Google Cloud Run

Deploy as containerized service on Cloud Run.

**Architecture:**
```
Monday Automation 
  → POST to Cloud Run endpoint
  → Container starts/scales automatically
  → Runs webhook_handler.py
  → Syncs to SharePoint
```

**Webhook URL for Monday:**
```
POST https://sync-language-profile-{random}.cloudfun.run/sync-language-profile
```

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY webhook_handler.py .

CMD ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=5000"]
```

**Advantages:**
- Simple container deployment
- Pay-per-request
- Fast cold starts (~2 seconds)
- Built-in logging
- GCP integration

**Disadvantages:**
- Google Cloud account required
- Slightly more setup than VPS
- Not free tier (though very cheap)

**Status:** NOT RECOMMENDED — VPS is simpler

---

## Decision Matrix

| Factor | VPS | GitHub Actions | Lambda | Cloud Run |
|--------|-----|---|--------|----------|
| **Response Time** | ⚡ 1-2s | ⏳ 30-60s | ⏳ 3-5s | ⏳ 2-3s |
| **Cost** | 💰 ~$10/mo | ✅ Free (3000 min) | ✅ Pay-per-call (~$0.20M) | ✅ Pay-per-call (~$0.40M) |
| **Setup Complexity** | ⭐ Simple | ⭐⭐ Medium | ⭐⭐⭐ Complex | ⭐⭐ Medium |
| **Maintenance** | 📋 Manage VPS | ✅ GitHub manages | ✅ AWS manages | ✅ Google manages |
| **Reliability** | ⭐⭐⭐⭐ High | ⭐⭐⭐⭐ High | ⭐⭐⭐⭐ High | ⭐⭐⭐⭐ High |
| **Monitoring** | 📊 `journalctl` | 📊 GitHub UI | 📊 CloudWatch | 📊 Cloud Logging |
| **Scaling** | Manual | Auto | Auto | Auto |

---

## Recommendation

**Keep VPS approach** because:
1. ✅ Already working and tested
2. ✅ Fastest response time (1-2 seconds)
3. ✅ Simplest setup (Flask + systemd)
4. ✅ Full control and visibility
5. ✅ Code is version controlled in Git
6. ✅ Cheapest for this volume (<1000 requests/month)
7. ✅ Easy to troubleshoot (SSH + journalctl)

---

## If VPS Becomes Unavailable

**Quick Migration Path:**

1. **To GitHub Actions (fastest):**
   - Push webhook_handler.py to GitHub
   - Create .github/workflows/sync-language-profile.yml
   - Update Monday webhook URL to GitHub dispatches endpoint
   - Add GitHub secrets (MONDAY_API_TOKEN, TENANT_ID, etc.)

2. **To Cloud Run (best balance):**
   - Create Dockerfile
   - Run: `gcloud run deploy sync-language-profile --source .`
   - Update Monday webhook URL to Cloud Run endpoint
   - Set environment variables via Cloud Run UI

3. **To Lambda (if already using AWS):**
   - Wrap webhook_handler.py with lambda_handler()
   - Create API Gateway endpoint
   - Deploy via SAM or CloudFormation
   - Update Monday webhook URL

---

## Monitoring All Approaches

### VPS (Current)
```bash
journalctl -u monday-webhook -f
systemctl status monday-webhook
```

### GitHub Actions
```
GitHub → Actions → sync-language-profile workflow → View logs
```

### Lambda
```bash
aws lambda tail /aws/lambda/sync-language-profile --follow
```

### Cloud Run
```bash
gcloud logging read "resource.type=cloud_run_revision"
```

---

## Rollback Procedure

If anything goes wrong:

**VPS:**
```bash
systemctl stop monday-webhook
# Disable webhook in Monday Automation
# Fix code
systemctl start monday-webhook
```

**GitHub Actions / Cloud Run:**
```
Disable webhook in Monday Automation
Delete workflow/deployment
Revert to previous working commit
Redeploy
```

---

**Current Status:** VPS approach active and stable. No migration needed. This document serves as a reference for future enhancements or if infrastructure requirements change.
