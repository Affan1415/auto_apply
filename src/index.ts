#!/usr/bin/env node

import dotenv from 'dotenv';
import autoApplyWorker from './autoApplyWorker';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

async function main() {
  try {
    logger.info('Starting AutoTalent Auto-Apply System');
    
    // Check if running in manual mode
    const args = process.argv.slice(2);
    const isManualMode = args.includes('--manual');
    const userId = args.find(arg => arg.startsWith('--user='))?.split('=')[1];

    if (isManualMode) {
      logger.info('Running in manual mode');
      await autoApplyWorker.runManualJob(userId);
      process.exit(0);
    }

    // Start the scheduler
    autoApplyWorker.startScheduler();
    
    logger.info('AutoTalent Auto-Apply System is running. Press Ctrl+C to stop.');
    
    // Keep the process alive
    process.stdin.resume();
    
  } catch (error) {
    logger.error('Failed to start AutoTalent Auto-Apply System:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
main(); 