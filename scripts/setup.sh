#!/bin/bash

# AutoTalent Auto-Apply System Setup Script for EC2
# This script sets up the environment and dependencies for the AutoTalent automation system

set -e

echo "🚀 Setting up AutoTalent Auto-Apply System on EC2..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 18.x
echo "📦 Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright dependencies
echo "📦 Installing Playwright dependencies..."
sudo apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0

# Install additional dependencies for headless browser
echo "📦 Installing additional browser dependencies..."
sudo apt-get install -y \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/autotalent
sudo chown $USER:$USER /opt/autotalent

# Copy application files (assuming they're in the current directory)
echo "📋 Copying application files..."
cp -r . /opt/autotalent/
cd /opt/autotalent

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install chromium

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs

# Create temp directory for resume files
echo "📁 Creating temp directory..."
mkdir -p temp

# Set up environment file
echo "⚙️ Setting up environment configuration..."
if [ ! -f .env ]; then
    echo "Please create a .env file with your configuration:"
    echo "cp env.example .env"
    echo "Then edit .env with your actual values:"
    echo "- SUPABASE_URL"
    echo "- SUPABASE_ANON_KEY"
    echo "- SUPABASE_SERVICE_ROLE_KEY"
    echo "- OPENAI_API_KEY"
fi

# Build the application
echo "🔨 Building the application..."
npm run build

# Create systemd service file
echo "🔧 Creating systemd service..."
sudo tee /etc/systemd/system/autotalent-auto-apply.service > /dev/null <<EOF
[Unit]
Description=AutoTalent Auto-Apply System
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/autotalent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "🔧 Enabling systemd service..."
sudo systemctl daemon-reload
sudo systemctl enable autotalent-auto-apply.service

# Create logrotate configuration
echo "📋 Setting up log rotation..."
sudo tee /etc/logrotate.d/autotalent > /dev/null <<EOF
/opt/autotalent/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        systemctl reload autotalent-auto-apply.service
    endscript
}
EOF

# Set up cron job for monitoring (optional)
echo "⏰ Setting up monitoring cron job..."
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/autotalent/scripts/monitor.sh") | crontab -

# Create monitoring script
echo "📋 Creating monitoring script..."
mkdir -p scripts
tee scripts/monitor.sh > /dev/null <<EOF
#!/bin/bash
# Monitor script for AutoTalent Auto-Apply System

SERVICE_NAME="autotalent-auto-apply"
LOG_FILE="/opt/autotalent/logs/monitor.log"

if ! systemctl is-active --quiet \$SERVICE_NAME; then
    echo "\$(date): Service \$SERVICE_NAME is down, restarting..." >> \$LOG_FILE
    systemctl restart \$SERVICE_NAME
fi
EOF

chmod +x scripts/monitor.sh

# Set proper permissions
echo "🔐 Setting proper permissions..."
chmod +x scripts/*.sh
chmod 600 .env 2>/dev/null || true

echo "✅ Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Edit /opt/autotalent/.env with your configuration"
echo "2. Start the service: sudo systemctl start autotalent-auto-apply"
echo "3. Check status: sudo systemctl status autotalent-auto-apply"
echo "4. View logs: sudo journalctl -u autotalent-auto-apply -f"
echo ""
echo "🔧 Useful commands:"
echo "- Start service: sudo systemctl start autotalent-auto-apply"
echo "- Stop service: sudo systemctl stop autotalent-auto-apply"
echo "- Restart service: sudo systemctl restart autotalent-auto-apply"
echo "- View logs: sudo journalctl -u autotalent-auto-apply -f"
echo "- Manual run: cd /opt/autotalent && npm run dev -- --manual" 