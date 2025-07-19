-- AutoTalent Auto-Apply Database Schema
-- This file contains all the necessary tables for the AutoTalent automation system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Auto apply configurations table (already exists based on requirements)
CREATE TABLE IF NOT EXISTS auto_apply_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  form_id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Personal Info
  full_name TEXT, 
  phone TEXT, 
  email TEXT, 
  address TEXT, 
  city TEXT, 
  state TEXT,
  country TEXT, 
  zip_code TEXT, 
  current_job_title TEXT, 
  current_company TEXT,
  current_salary TEXT, 
  desired_salary TEXT, 
  notice_period TEXT, 
  work_auth TEXT,
  field_of_study TEXT, 
  graduation_year TEXT, 
  linkedin_url TEXT, 
  website TEXT, 
  github_url TEXT,

  -- Resume
  selected_resume_id UUID,
  uploaded_resume_path TEXT,

  -- App Questions
  legally_authorized TEXT, 
  require_sponsorship TEXT, 
  current_location TEXT,
  years_experience TEXT, 
  expected_salary TEXT, 
  start_date TEXT, 
  interest_reason TEXT,
  key_skills TEXT, 
  disabilities TEXT, 
  gender TEXT, 
  race TEXT, 
  veteran TEXT,

  -- Search
  search_terms TEXT, 
  randomize_search BOOLEAN DEFAULT FALSE,
  search_location TEXT, 
  experience_level TEXT, 
  salary_range TEXT,
  target_experience TEXT, 
  preferred_job_types TEXT[],
  industries TEXT, 
  blacklisted_companies TEXT, 
  whitelisted_companies TEXT,
  skip_keywords TEXT, 
  prioritize_keywords TEXT,
  skip_security_clearance BOOLEAN DEFAULT FALSE,
  follow_companies BOOLEAN DEFAULT FALSE,

  -- Flags
  resume_ready BOOLEAN DEFAULT FALSE,
  use_web_ui BOOLEAN DEFAULT TRUE,

  -- JSON Data
  skills JSONB,
  work_experience JSONB,
  education JSONB,
  projects TEXT,
  certifications TEXT
);

-- Applied jobs tracking table
CREATE TABLE IF NOT EXISTS applied_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_url TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('applied', 'error', 'skipped', 'duplicate')),
  notes TEXT,
  error_message TEXT,
  application_data JSONB,
  
  -- Indexes for performance
  UNIQUE(user_id, job_url),
  INDEX idx_applied_jobs_user_id (user_id),
  INDEX idx_applied_jobs_status (status),
  INDEX idx_applied_jobs_applied_at (applied_at)
);

-- Job search history table
CREATE TABLE IF NOT EXISTS job_search_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_terms TEXT NOT NULL,
  search_location TEXT,
  jobs_found INTEGER DEFAULT 0,
  jobs_applied INTEGER DEFAULT 0,
  search_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  INDEX idx_job_search_history_user_id (user_id),
  INDEX idx_job_search_history_date (search_date)
);

-- Application statistics table (for caching)
CREATE TABLE IF NOT EXISTS application_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_applied INTEGER DEFAULT 0,
  successful_applications INTEGER DEFAULT 0,
  failed_applications INTEGER DEFAULT 0,
  last_applied_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id),
  INDEX idx_application_stats_user_id (user_id)
);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'debug')),
  message TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_url TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  INDEX idx_system_logs_level (level),
  INDEX idx_system_logs_user_id (user_id),
  INDEX idx_system_logs_created_at (created_at)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_auto_apply_configs_user_id ON auto_apply_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_apply_configs_resume_ready ON auto_apply_configs(resume_ready);
CREATE INDEX IF NOT EXISTS idx_auto_apply_configs_use_web_ui ON auto_apply_configs(use_web_ui);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update the updated_at column
CREATE TRIGGER update_auto_apply_configs_updated_at 
    BEFORE UPDATE ON auto_apply_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a function to update application stats
CREATE OR REPLACE FUNCTION update_application_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO application_stats (user_id, total_applied, successful_applications, failed_applications, last_applied_at)
    VALUES (
        NEW.user_id,
        1,
        CASE WHEN NEW.status = 'applied' THEN 1 ELSE 0 END,
        CASE WHEN NEW.status = 'error' THEN 1 ELSE 0 END,
        NEW.applied_at
    )
    ON CONFLICT (user_id) DO UPDATE SET
        total_applied = application_stats.total_applied + 1,
        successful_applications = application_stats.successful_applications + 
            CASE WHEN NEW.status = 'applied' THEN 1 ELSE 0 END,
        failed_applications = application_stats.failed_applications + 
            CASE WHEN NEW.status = 'error' THEN 1 ELSE 0 END,
        last_applied_at = CASE WHEN NEW.applied_at > application_stats.last_applied_at 
                               THEN NEW.applied_at 
                               ELSE application_stats.last_applied_at END,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update application stats
CREATE TRIGGER update_application_stats_trigger
    AFTER INSERT ON applied_jobs
    FOR EACH ROW EXECUTE FUNCTION update_application_stats();

-- Create storage bucket for resumes
-- Note: This needs to be run in Supabase dashboard or via API
-- INSERT INTO storage.buckets (id, name, public) VALUES ('resumes', 'resumes', false);

-- Row Level Security (RLS) policies
ALTER TABLE auto_apply_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applied_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_search_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for auto_apply_configs
CREATE POLICY "Users can view their own configs" ON auto_apply_configs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own configs" ON auto_apply_configs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own configs" ON auto_apply_configs
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for applied_jobs
CREATE POLICY "Users can view their own applications" ON applied_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own applications" ON applied_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for job_search_history
CREATE POLICY "Users can view their own search history" ON job_search_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own search history" ON job_search_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for application_stats
CREATE POLICY "Users can view their own stats" ON application_stats
    FOR SELECT USING (auth.uid() = user_id);

-- RLS Policies for system_logs (admin only for now)
CREATE POLICY "Admins can view all logs" ON system_logs
    FOR SELECT USING (auth.uid() IN (
        SELECT user_id FROM auth.users WHERE email IN (
            SELECT email FROM auth.users WHERE email LIKE '%@autotalent.com'
        )
    )); 