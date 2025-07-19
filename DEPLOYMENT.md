# AutoTalent Auto-Apply System - Deployment Guide

This guide covers deploying the AutoTalent automation system to AWS EC2 and other environments.

## 🚀 Quick Start (EC2)

### 1. Launch EC2 Instance

**Recommended Instance Type:**
- **t3.medium** (2 vCPU, 4 GB RAM) for development
- **t3.large** (2 vCPU, 8 GB RAM) for production
- **c5.large** (2 vCPU, 4 GB RAM) for high-performance needs

**AMI:** Ubuntu 22.04 LTS

**Security Groups:**
- SSH (Port 22) - Your IP only
- HTTP (Port 80) - Optional, for monitoring
- HTTPS (Port 443) - Optional, for monitoring

### 2. Connect and Setup

```bash
# Connect to your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Clone the repository
git clone <your-repo-url>
cd auto_apply

# Run the setup script
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 3. Configure Environment

```bash
# Copy environment template
cp env.example .env

# Edit with your actual values
sudo nano /opt/autotalent/.env
```

**Required Environment Variables:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-api-key
NODE_ENV=production
LOG_LEVEL=info
CRON_INTERVAL=15
BROWSER_HEADLESS=true
```

### 4. Start the Service

```bash
# Start the service
sudo systemctl start autotalent-auto-apply

# Enable auto-start on boot
sudo systemctl enable autotalent-auto-apply

# Check status
sudo systemctl status autotalent-auto-apply
```

## 🗄️ Database Setup

### 1. Supabase Project Setup

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create new project
   - Note your project URL and API keys

2. **Run Database Schema**
   ```sql
   -- Copy and paste the contents of src/database/schema.sql
   -- into your Supabase SQL editor and execute
   ```

3. **Create Storage Bucket**
   ```sql
   INSERT INTO storage.buckets (id, name, public) 
   VALUES ('resumes', 'resumes', false);
   ```

4. **Configure RLS Policies**
   - The schema includes RLS policies
   - Ensure they match your security requirements

### 2. Test Database Connection

```bash
# Run the test script
cd /opt/autotalent
npm run test
```

## 🔧 Configuration Options

### Cron Schedule

The system runs every 15 minutes by default. You can change this:

```env
# Run every 5 minutes
CRON_INTERVAL=5

# Run every hour
CRON_INTERVAL=60
```

### Browser Settings

```env
# Run with visible browser (for debugging)
BROWSER_HEADLESS=false

# Increase timeout for slow connections
BROWSER_TIMEOUT=60000

# Set viewport size
BROWSER_VIEWPORT_WIDTH=1920
BROWSER_VIEWPORT_HEIGHT=1080
```

### Logging

```env
# Debug level logging
LOG_LEVEL=debug

# Production logging
LOG_LEVEL=info
```

## 📊 Monitoring and Logs

### View Service Logs

```bash
# Real-time logs
sudo journalctl -u autotalent-auto-apply -f

# Recent logs
sudo journalctl -u autotalent-auto-apply -n 100

# Logs since yesterday
sudo journalctl -u autotalent-auto-apply --since yesterday
```

### Application Logs

```bash
# View application logs
tail -f /opt/autotalent/logs/combined.log

# View error logs
tail -f /opt/autotalent/logs/error.log

# View monitoring logs
tail -f /opt/autotalent/logs/monitor.log
```

### Health Checks

```bash
# Check service status
sudo systemctl is-active autotalent-auto-apply

# Check if process is running
ps aux | grep node

# Check disk space
df -h

# Check memory usage
free -h
```

## 🔄 Updates and Maintenance

### Updating the Application

```bash
# Stop the service
sudo systemctl stop autotalent-auto-apply

# Pull latest changes
cd /opt/autotalent
git pull origin main

# Install dependencies
npm install

# Build the application
npm run build

# Start the service
sudo systemctl start autotalent-auto-apply
```

### Backup and Restore

```bash
# Backup database (from Supabase dashboard)
# Export your data using Supabase's export feature

# Backup application files
tar -czf autotalent-backup-$(date +%Y%m%d).tar.gz /opt/autotalent

# Backup logs
tar -czf autotalent-logs-$(date +%Y%m%d).tar.gz /opt/autotalent/logs
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Service Won't Start

```bash
# Check service status
sudo systemctl status autotalent-auto-apply

# Check logs for errors
sudo journalctl -u autotalent-auto-apply -n 50

# Check if port is in use
sudo netstat -tlnp | grep :3000
```

#### 2. Browser Won't Launch

```bash
# Check Playwright installation
npx playwright --version

# Reinstall Playwright browsers
npx playwright install chromium

# Check system dependencies
ldd $(which chromium-browser)
```

#### 3. Database Connection Issues

```bash
# Test Supabase connection
curl -X GET "https://your-project.supabase.co/rest/v1/" \
  -H "apikey: your-anon-key"

# Check environment variables
grep SUPABASE /opt/autotalent/.env
```

#### 4. OpenAI API Issues

```bash
# Test OpenAI connection
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug

# Run with visible browser
export BROWSER_HEADLESS=false

# Run manually for testing
cd /opt/autotalent
npm run dev -- --manual
```

## 🔒 Security Considerations

### 1. Environment Variables

- Never commit `.env` files to version control
- Use strong, unique API keys
- Rotate keys regularly
- Use IAM roles when possible

### 2. Network Security

- Restrict SSH access to specific IPs
- Use key-based authentication
- Consider using a VPN
- Monitor access logs

### 3. Application Security

- Keep dependencies updated
- Monitor for security vulnerabilities
- Use HTTPS for all external communications
- Implement rate limiting

### 4. Data Protection

- Encrypt sensitive data at rest
- Use secure connections to databases
- Implement proper backup strategies
- Follow GDPR/privacy regulations

## 📈 Scaling

### Vertical Scaling

For increased performance:

1. **Upgrade Instance Type**
   ```bash
   # Stop service
   sudo systemctl stop autotalent-auto-apply
   
   # Upgrade instance type in AWS console
   # Restart service
   sudo systemctl start autotalent-auto-apply
   ```

2. **Optimize Configuration**
   ```env
   # Increase browser timeout
   BROWSER_TIMEOUT=60000
   
   # Reduce cron interval
   CRON_INTERVAL=10
   ```

### Horizontal Scaling

For multiple instances:

1. **Load Balancer Setup**
   - Use AWS Application Load Balancer
   - Configure health checks
   - Set up auto-scaling groups

2. **Database Optimization**
   - Use read replicas
   - Implement connection pooling
   - Optimize queries

3. **Monitoring**
   - Set up CloudWatch alarms
   - Monitor application metrics
   - Track performance bottlenecks

## 🧪 Testing

### Manual Testing

```bash
# Test specific user
npm run dev -- --manual --user=user_id_here

# Test with visible browser
BROWSER_HEADLESS=false npm run dev -- --manual

# Test OpenAI integration
npm run test
```

### Automated Testing

```bash
# Run test suite
npm test

# Run with coverage
npm run test:coverage

# Run specific tests
npm test -- --grep "Supabase"
```

## 📞 Support

### Getting Help

1. **Check Logs First**
   - Service logs: `sudo journalctl -u autotalent-auto-apply`
   - Application logs: `/opt/autotalent/logs/`

2. **Common Solutions**
   - Restart service: `sudo systemctl restart autotalent-auto-apply`
   - Check disk space: `df -h`
   - Verify environment: `cat /opt/autotalent/.env`

3. **Contact Support**
   - Create GitHub issue
   - Check documentation
   - Review troubleshooting guide

### Emergency Procedures

```bash
# Emergency stop
sudo systemctl stop autotalent-auto-apply

# Emergency restart
sudo systemctl restart autotalent-auto-apply

# Rollback to previous version
cd /opt/autotalent
git checkout HEAD~1
npm install
npm run build
sudo systemctl restart autotalent-auto-apply
```

---

**AutoTalent Auto-Apply System** - Production deployment guide for automated job applications. 