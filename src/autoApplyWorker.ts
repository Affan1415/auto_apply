import cron from 'node-cron';
import dotenv from 'dotenv';
import supabaseManager from './supabaseClient';
import PlaywrightJobApplicator from './playwrightApply';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

class AutoApplyWorker {
  private isRunning = false;
  private playwrightApplicator: PlaywrightJobApplicator;

  constructor() {
    this.playwrightApplicator = new PlaywrightJobApplicator();
  }

  /**
   * Start the cron job scheduler
   */
  startScheduler(): void {
    const cronInterval = process.env.CRON_INTERVAL || '15';
    const cronExpression = `*/${cronInterval} * * * *`; // Every X minutes

    logger.info(`Starting AutoTalent auto-apply scheduler with interval: ${cronInterval} minutes`);

    cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        logger.info('Previous job still running, skipping this iteration');
        return;
      }

      await this.runAutoApplyJob();
    });

    logger.info('AutoTalent auto-apply scheduler started successfully');
  }

  /**
   * Run the main auto-apply job
   */
  async runAutoApplyJob(): Promise<void> {
    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting AutoTalent auto-apply job');

      // Get users with auto-apply enabled
      const users = await supabaseManager.getAutoApplyUsers();
      
      if (users.length === 0) {
        logger.info('No users found with auto-apply enabled');
        return;
      }

      logger.info(`Found ${users.length} users with auto-apply enabled`);

      // Initialize Playwright browser
      await this.playwrightApplicator.initialize();

      // Process each user
      for (const userConfig of users) {
        try {
          await this.processUser(userConfig);
        } catch (error) {
          logger.error(`Error processing user ${userConfig.id}:`, error);
          continue; // Continue with next user
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Auto-apply job completed in ${duration}ms`);

    } catch (error) {
      logger.error('Error in auto-apply job:', error);
    } finally {
      // Cleanup
      await this.playwrightApplicator.cleanup();
      this.isRunning = false;
    }
  }

  /**
   * Process a single user's auto-apply job
   */
  private async processUser(userConfig: any): Promise<void> {
    logger.info(`Processing auto-apply for user: ${userConfig.user_id}`);

    try {
      // Search for jobs
      const jobs = await this.playwrightApplicator.searchJobs(userConfig);
      
      if (jobs.length === 0) {
        logger.info(`No jobs found for user ${userConfig.user_id}`);
        return;
      }

      // Filter jobs based on user preferences
      const filteredJobs = this.playwrightApplicator.filterJobs(jobs, userConfig);
      
      if (filteredJobs.length === 0) {
        logger.info(`No jobs passed filters for user ${userConfig.user_id}`);
        return;
      }

      logger.info(`Found ${filteredJobs.length} suitable jobs for user ${userConfig.user_id}`);

      // Apply to jobs (limit to 10 per session as requested)
      const jobsToApply = filteredJobs.slice(0, 10);
      let appliedCount = 0;
      let errorCount = 0;

      for (const job of jobsToApply) {
        try {
          const result = await this.playwrightApplicator.applyToJob(job, userConfig);
          
          if (result.success) {
            appliedCount++;
            logger.info(`Successfully applied to job: ${job.title} at ${job.company}`);
          } else if (result.status === 'duplicate') {
            logger.info(`Skipped duplicate job: ${job.title}`);
          } else {
            errorCount++;
            logger.error(`Failed to apply to job: ${job.title} - ${result.errorMessage}`);
          }

          // Add delay between applications to avoid rate limiting
          await this.delay(2000 + Math.random() * 3000); // 2-5 seconds

        } catch (error) {
          errorCount++;
          logger.error(`Error applying to job ${job.title}:`, error);
        }
      }

      // Update user's last auto-applied timestamp
      await supabaseManager.updateLastAutoApplied(userConfig.id);

      logger.info(`User ${userConfig.id} processing complete: ${appliedCount} applied, ${errorCount} errors`);

    } catch (error) {
      logger.error(`Error processing user ${userConfig.id}:`, error);
      throw error;
    }
  }

  /**
   * Run a single manual job (for testing or immediate execution)
   */
  async runManualJob(userId?: string): Promise<void> {
    logger.info('Starting manual auto-apply job');

    try {
      // Get users (filter by userId if provided)
      let users = await supabaseManager.getAutoApplyUsers();
      
      if (userId) {
        users = users.filter(user => user.user_id === userId);
        if (users.length === 0) {
          logger.error(`No user found with ID: ${userId}`);
          return;
        }
      }

      if (users.length === 0) {
        logger.info('No users found with auto-apply enabled');
        return;
      }

      // Initialize Playwright browser
      await this.playwrightApplicator.initialize();

      // Process each user
      for (const userConfig of users) {
        try {
          await this.processUser(userConfig);
        } catch (error) {
          logger.error(`Error processing user ${userConfig.user_id}:`, error);
          continue;
        }
      }

    } catch (error) {
      logger.error('Error in manual auto-apply job:', error);
    } finally {
      await this.playwrightApplicator.cleanup();
    }
  }

  /**
   * Get application statistics for a user
   */
  async getUserStats(userId: string): Promise<any> {
    try {
      const stats = await supabaseManager.getUserApplicationStats(userId);
      return stats;
    } catch (error) {
      logger.error(`Error getting stats for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Utility function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Stop the scheduler
   */
  stopScheduler(): void {
    logger.info('Stopping AutoTalent auto-apply scheduler');
    // Note: cron.schedule doesn't have a direct stop method
    // The process will need to be terminated externally
  }
}

// Create and export singleton instance
const autoApplyWorker = new AutoApplyWorker();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  autoApplyWorker.stopScheduler();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  autoApplyWorker.stopScheduler();
  process.exit(0);
});

export default autoApplyWorker; 