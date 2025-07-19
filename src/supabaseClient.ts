import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AutoApplyConfig, AppliedJob } from './types';
import logger from './utils/logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class SupabaseManager {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) environment variables.');
    }

    this.client = createClient(supabaseUrl, supabaseKey);
    logger.info('Supabase client initialized');
  }

  /**
   * Get all users with auto-apply enabled
   */
  async getAutoApplyUsers(): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('Auto-Apply', true);

      if (error) {
        logger.error('Error fetching auto-apply users:', error);
        throw error;
      }

      logger.info(`Found ${data?.length || 0} users with auto-apply enabled`);
      return data || [];
    } catch (error) {
      logger.error('Failed to get auto-apply users:', error);
      throw error;
    }
  }

  /**
   * Check if a job URL has already been applied by a specific user
   */
  async hasAppliedToJob(userId: string, jobUrl: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('applied_jobs')
        .select('id')
        .eq('user_id', userId)
        .eq('job_url', jobUrl)
        .limit(1);

      if (error) {
        logger.error('Error checking if job already applied:', error);
        throw error;
      }

      return (data?.length || 0) > 0;
    } catch (error) {
      logger.error('Failed to check if job already applied:', error);
      throw error;
    }
  }

  /**
   * Log a job application to the applied_jobs table
   */
  async logApplication(application: Omit<AppliedJob, 'id' | 'applied_at'>): Promise<AppliedJob> {
    try {
      const { data, error } = await this.client
        .from('applied_jobs')
        .insert({
          ...application,
          applied_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        logger.error('Error logging application:', error);
        throw error;
      }

      logger.info(`Logged application for job: ${application.job_title} at ${application.company_name}`);
      return data;
    } catch (error) {
      logger.error('Failed to log application:', error);
      throw error;
    }
  }

  /**
   * Get user's resume file from Supabase storage
   */
  async getResumeFile(resumePath: string): Promise<ArrayBuffer | null> {
    try {
      if (!resumePath) {
        logger.warn('No resume path provided');
        return null;
      }

      const { data, error } = await this.client.storage
        .from('resumes')
        .download(resumePath);

      if (error) {
        logger.error('Error downloading resume:', error);
        throw error;
      }

      if (!data) {
        logger.warn('No resume data found');
        return null;
      }

      const arrayBuffer = await data.arrayBuffer();
      logger.info(`Successfully downloaded resume: ${resumePath}`);
      return arrayBuffer;
    } catch (error) {
      logger.error('Failed to get resume file:', error);
      throw error;
    }
  }

  /**
   * Update user's last auto-applied timestamp
   */
  async updateLastAutoApplied(userId: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('users')
        .update({ 
          last_auto_applied: new Date().toISOString() 
        })
        .eq('id', userId);

      if (error) {
        logger.error('Error updating last auto-applied timestamp:', error);
        throw error;
      }

      logger.info(`Updated last auto-applied timestamp for user: ${userId}`);
    } catch (error) {
      logger.error('Failed to update last auto-applied timestamp:', error);
      throw error;
    }
  }

  /**
   * Get application statistics for a user
   */
  async getUserApplicationStats(userId: string): Promise<{
    total_applied: number;
    successful: number;
    errors: number;
    last_applied?: string;
  }> {
    try {
      const { data, error } = await this.client
        .from('applied_jobs')
        .select('status, applied_at')
        .eq('user_id', userId);

      if (error) {
        logger.error('Error getting user application stats:', error);
        throw error;
      }

      const stats = {
        total_applied: data?.length || 0,
        successful: data?.filter(job => job.status === 'applied').length || 0,
        errors: data?.filter(job => job.status === 'error').length || 0,
        last_applied: data?.length ? 
          data.sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime())[0]?.applied_at : 
          undefined
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get user application stats:', error);
      throw error;
    }
  }

  /**
   * Get user profile data for job applications
   */
  async getUserProfile(userId: string): Promise<any> {
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        logger.error('Error fetching user profile:', error);
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get user profile:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const supabaseManager = new SupabaseManager();
export default supabaseManager; 