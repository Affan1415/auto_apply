import dotenv from 'dotenv';
import supabaseManager from '../supabaseClient';
import openAIManager from '../openaiClient';
import logger from '../utils/logger';

// Load environment variables
dotenv.config();

async function testSystem() {
  try {
    logger.info('🧪 Starting AutoTalent system tests...');

    // Test 1: Supabase Connection
    logger.info('Testing Supabase connection...');
    try {
      const users = await supabaseManager.getAutoApplyUsers();
      logger.info(`✅ Supabase connection successful. Found ${users.length} users with auto-apply enabled.`);
    } catch (error) {
      logger.error('❌ Supabase connection failed:', error);
      return;
    }

    // Test 2: OpenAI Connection
    logger.info('Testing OpenAI connection...');
    try {
      const testConfig = {
        user_id: 'test-user',
        full_name: 'John Doe',
        email: 'john@example.com',
        years_experience: '5',
        key_skills: 'JavaScript, TypeScript, React',
        resume_ready: true,
        use_web_ui: false
      } as any;

      const response = await openAIManager.generateAnswer(
        'What is your experience with JavaScript?',
        testConfig
      );

      logger.info(`✅ OpenAI connection successful. Generated answer: ${response.answer.substring(0, 50)}...`);
    } catch (error) {
      logger.error('❌ OpenAI connection failed:', error);
      return;
    }

    // Test 3: Environment Variables
    logger.info('Testing environment variables...');
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.error(`❌ Missing environment variables: ${missingVars.join(', ')}`);
      return;
    }

    logger.info('✅ All environment variables are set.');

    // Test 4: Database Schema Check
    logger.info('Testing database schema...');
    try {
      // Try to access the auto_apply_configs table
      const { data, error } = await supabaseManager['client']
        .from('auto_apply_configs')
        .select('count')
        .limit(1);

      if (error) {
        logger.error('❌ Database schema test failed:', error);
        return;
      }

      logger.info('✅ Database schema is accessible.');
    } catch (error) {
      logger.error('❌ Database schema test failed:', error);
      return;
    }

    logger.info('🎉 All tests passed! The AutoTalent system is ready to use.');

  } catch (error) {
    logger.error('❌ Test suite failed:', error);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testSystem().then(() => {
    process.exit(0);
  }).catch((error) => {
    logger.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { testSystem }; 