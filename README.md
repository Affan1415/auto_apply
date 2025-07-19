# AutoTalent Auto-Apply System

A comprehensive backend automation system for AutoTalent.com that automatically applies to jobs on Workable.com using Playwright, OpenAI GPT, and Supabase.

## 🚀 Features

- **Automated Job Applications**: Automatically applies to jobs on Workable.com
- **AI-Powered Form Filling**: Uses OpenAI GPT to generate intelligent answers for application questions
- **Smart Filtering**: Filters jobs based on user preferences, blacklisted companies, and keywords
- **Duplicate Prevention**: Tracks applied jobs to prevent duplicate applications
- **Resume Upload**: Automatically uploads user resumes from Supabase storage
- **Comprehensive Logging**: Detailed logging of all application attempts and results
- **EC2 Deployment Ready**: Includes setup scripts for AWS EC2 deployment

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Supabase      │    │   Workable.com  │
│   (AutoTalent)  │◄──►│   (Database)    │    │   (Job Board)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   OpenAI GPT    │◄──►│   Auto-Apply    │◄──►│   Playwright    │
│   (AI Answers)  │    │   Worker        │    │   (Browser)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- Node.js 18.x or higher
- Supabase account and project
- OpenAI API key
- AWS EC2 instance (for production deployment)

## 🛠️ Installation

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd auto_apply
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Playwright browsers**
   ```bash
   npx playwright install chromium
   ```

4. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

5. **Build the project**
   ```bash
   npm run build
   ```

### EC2 Deployment

1. **Run the setup script**
   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

2. **Configure environment variables**
   ```bash
   sudo nano /opt/autotalent/.env
   ```

3. **Start the service**
   ```bash
   sudo systemctl start autotalent-auto-apply
   sudo systemctl enable autotalent-auto-apply
   ```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Application Settings
NODE_ENV=production
LOG_LEVEL=info

# Cron Schedule (in minutes)
CRON_INTERVAL=15

# Browser Settings
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000
BROWSER_VIEWPORT_WIDTH=1920
BROWSER_VIEWPORT_HEIGHT=1080
```

### Database Setup

1. **Run the database schema**
   ```sql
   -- Execute the contents of src/database/schema.sql in your Supabase SQL editor
   ```

2. **Create storage bucket for resumes**
   ```sql
   INSERT INTO storage.buckets (id, name, public) VALUES ('resumes', 'resumes', false);
   ```

## 🚀 Usage

### Starting the Service

```bash
# Development mode
npm run dev

# Production mode
npm start

# Manual run (for testing)
npm run dev -- --manual

# Manual run for specific user
npm run dev -- --manual --user=user_id_here
```

### Service Management (EC2)

```bash
# Start service
sudo systemctl start autotalent-auto-apply

# Stop service
sudo systemctl stop autotalent-auto-apply

# Restart service
sudo systemctl restart autotalent-auto-apply

# Check status
sudo systemctl status autotalent-auto-apply

# View logs
sudo journalctl -u autotalent-auto-apply -f
```

## 📊 Database Schema

### Core Tables

- **`auto_apply_configs`**: User profiles and preferences
- **`applied_jobs`**: Tracking of all job applications
- **`job_search_history`**: Search history and statistics
- **`application_stats`**: Cached application statistics
- **`system_logs`**: System-level logging

### Key Fields

```sql
-- User Configuration
resume_ready BOOLEAN DEFAULT FALSE
use_web_ui BOOLEAN DEFAULT TRUE
search_terms TEXT
search_location TEXT
blacklisted_companies TEXT
skip_keywords TEXT

-- Application Tracking
status TEXT CHECK (status IN ('applied', 'error', 'skipped', 'duplicate'))
job_url TEXT UNIQUE(user_id, job_url)
```

## 🔧 API Reference

### Supabase Client

```typescript
// Get users with auto-apply enabled
const users = await supabaseManager.getAutoApplyUsers();

// Check if already applied to job
const hasApplied = await supabaseManager.hasAppliedToJob(userId, jobUrl);

// Log application
await supabaseManager.logApplication({
  user_id: userId,
  job_title: 'Software Engineer',
  company_name: 'Tech Corp',
  job_url: 'https://workable.com/job/123',
  status: 'applied'
});
```

### OpenAI Client

```typescript
// Generate answer for form question
const answer = await openAIManager.generateAnswer(
  'Why are you interested in this position?',
  userConfig
);

// Generate cover letter
const coverLetter = await openAIManager.generateCoverLetter(
  'Software Engineer',
  'Tech Corp',
  'Job description...',
  userConfig
);
```

### Playwright Applicator

```typescript
// Initialize browser
await playwrightApplicator.initialize();

// Search for jobs
const jobs = await playwrightApplicator.searchJobs(userConfig);

// Apply to job
const result = await playwrightApplicator.applyToJob(job, userConfig);

// Cleanup
await playwrightApplicator.cleanup();
```

## 📝 Logging

The system uses Winston for comprehensive logging:

- **File logs**: `logs/combined.log` and `logs/error.log`
- **Console logs**: In development mode
- **System logs**: Via systemd journal (EC2)

### Log Levels

- `error`: Application errors and failures
- `warn`: Warnings and non-critical issues
- `info`: General information and status updates
- `debug`: Detailed debugging information

## 🔒 Security

- **Row Level Security (RLS)**: All tables have RLS policies
- **Environment Variables**: Sensitive data stored in environment variables
- **Service Account**: Uses Supabase service role for backend operations
- **File Permissions**: Proper file permissions on EC2 deployment

## 🧪 Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Manual testing
npm run dev -- --manual --user=test_user_id
```

## 📈 Monitoring

### Health Checks

- Service status via systemd
- Application logs monitoring
- Database connection health
- OpenAI API availability

### Metrics

- Applications per user
- Success/failure rates
- Response times
- Error rates

## 🚨 Troubleshooting

### Common Issues

1. **Browser not starting**
   - Check Playwright dependencies are installed
   - Verify headless mode settings
   - Check system resources

2. **Database connection errors**
   - Verify Supabase credentials
   - Check network connectivity
   - Ensure RLS policies are correct

3. **OpenAI API errors**
   - Verify API key is valid
   - Check rate limits
   - Ensure sufficient credits

4. **Job application failures**
   - Check Workable.com structure changes
   - Verify form selectors
   - Review application logs

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
npm run dev

# Run with browser visible
export BROWSER_HEADLESS=false
npm run dev -- --manual
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:

- Create an issue in the repository
- Check the troubleshooting section
- Review the logs for error details

---

**AutoTalent Auto-Apply System** - Automating job applications with AI intelligence.
