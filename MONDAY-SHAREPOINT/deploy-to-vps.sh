#!/bin/bash
# Deploy webhook_handler.py to Bizdynamix VPS
# 
# Usage:
#   ./deploy-to-vps.sh [--skip-install] [--no-systemd]
#
# Options:
#   --skip-install    Skip pip install (already done)
#   --no-systemd      Don't create systemd service (manual start instead)

set -e

# Configuration
VPS_HOST="154.66.196.129"
VPS_USER="root"
VPS_PASSWORD="VIVO@2026#"
DEPLOY_DIR="/var/www/webhook-handler"
SERVICE_NAME="monday-webhook"
SERVICE_PORT=5000

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
SKIP_INSTALL=false
NO_SYSTEMD=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install) SKIP_INSTALL=true; shift ;;
        --no-systemd) NO_SYSTEMD=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Monday Webhook Handler → VPS Deployment${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "VPS Host:      $VPS_HOST"
echo "Deploy Path:   $DEPLOY_DIR"
echo "Service Port:  $SERVICE_PORT"
echo "Skip Install:  $SKIP_INSTALL"
echo "Use Systemd:   $([ "$NO_SYSTEMD" = true ] && echo 'NO' || echo 'YES')"
echo ""

# Step 1: Create requirements.txt if missing
if [ ! -f "requirements.txt" ]; then
    echo -e "${YELLOW}[1/5] Creating requirements.txt...${NC}"
    cat > requirements.txt << 'EOF'
flask>=2.3.0
requests>=2.31.0
python-dotenv>=1.0.0
EOF
    echo -e "${GREEN}✓ requirements.txt created${NC}"
else
    echo -e "${YELLOW}[1/5] requirements.txt exists${NC}"
fi
echo ""

# Step 2: Copy files to VPS
echo -e "${YELLOW}[2/5] Copying files to VPS...${NC}"
sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST "mkdir -p $DEPLOY_DIR"
sshpass -p "$VPS_PASSWORD" scp -o StrictHostKeyChecking=no \
    webhook_handler.py \
    .env \
    requirements.txt \
    $VPS_USER@$VPS_HOST:$DEPLOY_DIR/
echo -e "${GREEN}✓ Files copied${NC}"
echo ""

# Step 3: Install dependencies (if not skipped)
if [ "$SKIP_INSTALL" = false ]; then
    echo -e "${YELLOW}[3/5] Installing Python dependencies...${NC}"
    sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST \
        "cd $DEPLOY_DIR && python3 -m ensurepip --upgrade && python3 -m pip install -r requirements.txt"
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${YELLOW}[3/5] Skipping pip install (--skip-install)${NC}"
fi
echo ""

# Step 4: Create systemd service (if not skipped)
if [ "$NO_SYSTEMD" = false ]; then
    echo -e "${YELLOW}[4/5] Setting up systemd service...${NC}"
    
    SERVICE_FILE=$(cat << EOF
[Unit]
Description=Monday Webhook Handler (Language Profile → SharePoint)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$DEPLOY_DIR
ExecStart=/usr/bin/python3 $DEPLOY_DIR/webhook_handler.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=monday-webhook

[Install]
WantedBy=multi-user.target
EOF
)

    sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST << EOSSH
cat > /etc/systemd/system/${SERVICE_NAME}.service << 'EOSERVICE'
${SERVICE_FILE}
EOSERVICE

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}
systemctl status ${SERVICE_NAME}
EOSSH
    
    echo -e "${GREEN}✓ Systemd service created and started${NC}"
else
    echo -e "${YELLOW}[4/5] Skipping systemd setup (--no-systemd)${NC}"
    echo -e "${YELLOW}    Manual start: ssh $VPS_USER@$VPS_HOST \"cd $DEPLOY_DIR && python webhook_handler.py\"${NC}"
fi
echo ""

# Step 5: Verify deployment
echo -e "${YELLOW}[5/5] Verifying deployment...${NC}"
sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST \
    "ls -lah $DEPLOY_DIR/ && echo '' && echo 'Environment variables:' && cat $DEPLOY_DIR/.env | grep -E '^[A-Z_]+=' | head -3"
echo -e "${GREEN}✓ Deployment verified${NC}"
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📍 Webhook URL:"
echo "   http://$VPS_HOST:$SERVICE_PORT/sync-language-profile"
echo ""
echo "📋 Management Commands:"
echo "   Start:    sshpass -p '$VPS_PASSWORD' ssh $VPS_USER@$VPS_HOST 'systemctl start $SERVICE_NAME'"
echo "   Stop:     sshpass -p '$VPS_PASSWORD' ssh $VPS_USER@$VPS_HOST 'systemctl stop $SERVICE_NAME'"
echo "   Status:   sshpass -p '$VPS_PASSWORD' ssh $VPS_USER@$VPS_HOST 'systemctl status $SERVICE_NAME'"
echo "   Logs:     sshpass -p '$VPS_PASSWORD' ssh $VPS_USER@$VPS_HOST 'journalctl -u $SERVICE_NAME -f'"
echo ""
echo "🔗 Add to Monday Vibe automation webhook URL:"
echo "   http://$VPS_HOST:$SERVICE_PORT/sync-language-profile"
echo ""
