-- AutoTalent Database Setup Script
-- Run this in your Supabase SQL editor

-- 1. Create applied_jobs table to track job applications
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
  
  -- Prevent duplicate applications
  UNIQUE(user_id, job_url)
);

-- 2. Add last_auto_applied column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_auto_applied TIMESTAMP WITH TIME ZONE;

-- 3. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_applied_jobs_user_id ON applied_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_applied_jobs_status ON applied_jobs(status);
CREATE INDEX IF NOT EXISTS idx_applied_jobs_applied_at ON applied_jobs(applied_at);

-- 4. Enable Row Level Security
ALTER TABLE applied_jobs ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies
CREATE POLICY "Users can view their own applications" ON applied_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own applications" ON applied_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. Create storage bucket for resumes (if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('resumes', 'resumes', false);

-- 7. Grant permissions (if needed)
GRANT ALL ON applied_jobs TO authenticated;
GRANT ALL ON applied_jobs TO service_role; 