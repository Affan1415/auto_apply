import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { AutoApplyConfig, JobSearchResult, ApplicationResult, FormField } from './types';
import supabaseManager from './supabaseClient';
import openAIManager from './openaiClient';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

class PlaywrightJobApplicator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /**
   * Initialize browser and context
   */
  async initialize(): Promise<void> {
    try {
      const headless = process.env.BROWSER_HEADLESS === 'true';
      const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000');
      const viewportWidth = parseInt(process.env.BROWSER_VIEWPORT_WIDTH || '1920');
      const viewportHeight = parseInt(process.env.BROWSER_VIEWPORT_HEIGHT || '1080');

      this.browser = await chromium.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      this.page = await this.context.newPage();
      
      // Set default timeout
      this.page.setDefaultTimeout(timeout);
      
      logger.info('Playwright browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Playwright browser:', error);
      throw error;
    }
  }

  /**
   * Search for jobs on Workable.com
   */
  async searchJobs(userConfig: any): Promise<JobSearchResult[]> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Use default search terms since we don't have specific preferences in users table
      const searchTerms = 'software engineer developer programmer';
      const location = 'Remote';
      
      // Navigate to Workable search page
      const searchUrl = `https://jobs.workable.com/search?q=${encodeURIComponent(searchTerms)}&location=${encodeURIComponent(location)}`;
      
      logger.info(`Searching jobs on Workable: ${searchUrl}`);
      await this.page.goto(searchUrl, { waitUntil: 'networkidle' });

      // Wait for job listings to load (try multiple selectors)
      let jobCards = null;
      try {
        await this.page.waitForSelector('[data-testid="job-card"]', { timeout: 5000 });
        jobCards = '[data-testid="job-card"]';
      } catch (error) {
        try {
          await this.page.waitForSelector('.job-card', { timeout: 5000 });
          jobCards = '.job-card';
        } catch (error) {
          try {
            await this.page.waitForSelector('[class*="job"]', { timeout: 5000 });
            jobCards = '[class*="job"]';
          } catch (error) {
            // If no specific job cards found, try to find any job links
            await this.page.waitForSelector('a[href*="/jobs/"]', { timeout: 5000 });
            jobCards = 'a[href*="/jobs/"]';
          }
        }
      }

      // Extract job listings
      const jobs = await this.page.evaluate((selector: string) => {
        const elements = document.querySelectorAll(selector);
        const results: any[] = [];

        elements.forEach((element: Element) => {
          // Try different selectors for job information
          const titleElement = element.querySelector('[data-testid="job-title"]') || 
                              element.querySelector('.job-title') || 
                              element.querySelector('h3') || 
                              element.querySelector('h2');
          
          const companyElement = element.querySelector('[data-testid="company-name"]') || 
                                element.querySelector('.company-name') || 
                                element.querySelector('[class*="company"]');
          
          const locationElement = element.querySelector('[data-testid="job-location"]') || 
                                 element.querySelector('.job-location') || 
                                 element.querySelector('[class*="location"]');
          
          const linkElement = element.querySelector('a[href*="/jobs/"]') || 
                             element.closest('a[href*="/jobs/"]') || 
                             element;

          if (titleElement && linkElement) {
            const url = linkElement instanceof HTMLAnchorElement ? linkElement.href : 
                       linkElement.querySelector('a')?.href || 
                       (element as HTMLAnchorElement)?.href || '';
            
            if (url) {
              results.push({
                title: titleElement.textContent?.trim() || '',
                company: companyElement?.textContent?.trim() || 'Unknown Company',
                location: locationElement?.textContent?.trim() || 'Remote',
                url: url,
                description: '',
                posted_date: ''
              });
            }
          }
        });

        // Remove duplicates based on URL
        const uniqueJobs = results.filter((job, index, self) => 
          index === self.findIndex(j => j.url === job.url)
        );
        
        return uniqueJobs.slice(0, 10); // Limit to first 10 unique jobs
      }, jobCards);

      logger.info(`Found ${jobs.length} jobs on Workable`);
      return jobs;

    } catch (error) {
      logger.error('Error searching jobs on Workable:', error);
      return [];
    }
  }

  /**
   * Filter jobs based on user preferences
   */
  filterJobs(jobs: JobSearchResult[], userConfig: any): JobSearchResult[] {
    return jobs.filter(job => {
      // Skip blacklisted companies (if user has this field)
      if (userConfig.blacklisted_companies) {
        const blacklisted = userConfig.blacklisted_companies.toLowerCase().split(',').map((c: string) => c.trim());
        if (blacklisted.some((company: string) => job.company.toLowerCase().includes(company))) {
          logger.info(`Skipping blacklisted company: ${job.company}`);
          return false;
        }
      }

      // Skip jobs with blacklisted keywords (if user has this field)
      if (userConfig.skip_keywords) {
        const skipKeywords = userConfig.skip_keywords.toLowerCase().split(',').map((k: string) => k.trim());
        const jobText = `${job.title} ${job.company} ${job.description}`.toLowerCase();
        if (skipKeywords.some((keyword: string) => jobText.includes(keyword))) {
          logger.info(`Skipping job with blacklisted keyword: ${job.title}`);
          return false;
        }
      }

      // Check for security clearance requirement (if user has this field)
      if (userConfig.skip_security_clearance) {
        const securityKeywords = ['security clearance', 'clearance', 'secret', 'top secret', 'ts/sci'];
        const jobText = `${job.title} ${job.description}`.toLowerCase();
        if (securityKeywords.some((keyword: string) => jobText.includes(keyword))) {
          logger.info(`Skipping job requiring security clearance: ${job.title}`);
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply to a specific job
   */
  async applyToJob(job: JobSearchResult, userConfig: any): Promise<ApplicationResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Set a global timeout for the entire application process
    const applicationTimeout = 60000; // 60 seconds
    const startTime = Date.now();

    try {
      logger.info(`Applying to job: ${job.title} at ${job.company}`);

      // Check if already applied
      const alreadyApplied = await supabaseManager.hasAppliedToJob(userConfig.id, job.url);
      if (alreadyApplied) {
        logger.info(`Already applied to job: ${job.title}`);
        return {
          success: false,
          jobUrl: job.url,
          jobTitle: job.title,
          companyName: job.company,
          status: 'duplicate',
          notes: 'Already applied to this job'
        };
      }

      // Navigate to job page with timeout
      await Promise.race([
        this.page.goto(job.url, { waitUntil: 'networkidle' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 30000))
      ]);

      // Wait for apply button and click it
      const applyButton = await this.page.waitForSelector('[data-testid="apply-button"], .apply-button, button:has-text("Apply")', { timeout: 10000 });
      
      // Check if there's a backdrop/modal blocking the click
      const backdrop = await this.page.$('[data-ui="backdrop"], .backdrop, .modal-overlay');
      if (backdrop) {
        // Try to close the backdrop by clicking outside or pressing Escape
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
      }
      
      // Try to click the apply button
      try {
        await applyButton?.click();
      } catch (error) {
        // If click fails, try alternative methods
        await this.page.evaluate((button) => {
          if (button) (button as HTMLElement).click();
        }, applyButton);
      }

      // Wait for application form to load
      try {
        await this.page.waitForSelector('form, [data-testid="application-form"]', { timeout: 10000 });
      } catch (error) {
        // If form doesn't load, the job might not be accepting applications
        logger.warn(`No application form found for job: ${job.title}`);
        throw new Error('No application form available');
      }

      // Fill out the application form
      await this.fillApplicationForm(userConfig);

      // Submit the application with timeout
      const submitButton = await this.page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
      if (submitButton) {
        await submitButton.click();
        
        // Wait for submission confirmation with timeout
        await Promise.race([
          this.page.waitForTimeout(5000),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Submission timeout')), 10000))
        ]);
        
        // Check for success indicators
        const successIndicator = await this.page.$('.success, .confirmation, [data-testid="success"]');
        
        if (successIndicator) {
          logger.info(`Successfully applied to job: ${job.title}`);
          
          // Log the application
          await supabaseManager.logApplication({
            user_id: userConfig.id,
            job_title: job.title,
            company_name: job.company,
            job_url: job.url,
            status: 'applied',
            notes: 'Successfully applied via AutoTalent'
          });

          return {
            success: true,
            jobUrl: job.url,
            jobTitle: job.title,
            companyName: job.company,
            status: 'applied',
            notes: 'Successfully applied'
          };
        } else {
          throw new Error('No success indicator found after submission');
        }
              } else {
          throw new Error('Submit button not found');
        }

    } catch (error) {
      // Check if we've exceeded the global timeout
      if (Date.now() - startTime > applicationTimeout) {
        logger.error(`Application timeout for job ${job.title} after ${applicationTimeout}ms`);
        error = new Error(`Application timeout after ${applicationTimeout}ms`);
      } else {
        logger.error(`Error applying to job ${job.title}:`, error);
      }
      
      // Log the failed application
      await supabaseManager.logApplication({
        user_id: userConfig.id,
        job_title: job.title,
        company_name: job.company,
        job_url: job.url,
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        notes: 'Failed to apply'
      });

      return {
        success: false,
        jobUrl: job.url,
        jobTitle: job.title,
        companyName: job.company,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fill out the application form
   */
  private async fillApplicationForm(userConfig: any): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Fill basic form fields
      await this.fillBasicFields(userConfig);
      
      // Handle file uploads (resume)
      await this.handleFileUploads(userConfig);
      
      // Handle dynamic questions
      await this.handleDynamicQuestions(userConfig);

    } catch (error) {
      logger.error('Error filling application form:', error);
      throw error;
    }
  }

  /**
   * Fill basic form fields
   */
  private async fillBasicFields(userConfig: any): Promise<void> {
    if (!this.page) return;

    const fieldMappings = [
      { configField: 'name', selectors: ['input[name*="name" i]', 'input[name*="full" i]', '[data-testid="name-input"]'] },
      { configField: 'email', selectors: ['input[type="email"]', 'input[name*="email" i]', '[data-testid="email-input"]'] },
      { configField: 'phone', selectors: ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]'] },
      { configField: 'location', selectors: ['input[name*="location" i]', 'input[name*="city" i]', '[data-testid="location-input"]'] },
      { configField: 'experience', selectors: ['input[name*="experience" i]', 'select[name*="experience" i]'] },
      { configField: 'salary', selectors: ['input[name*="salary" i]', 'input[name*="compensation" i]'] },
      { configField: 'linkedin', selectors: ['input[name*="linkedin" i]', 'input[name*="profile" i]'] },
      { configField: 'github', selectors: ['input[name*="github" i]', 'input[name*="portfolio" i]'] }
    ];

    for (const mapping of fieldMappings) {
      const value = userConfig[mapping.configField as keyof AutoApplyConfig];
      if (value) {
        for (const selector of mapping.selectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              await element.fill(value as string);
              logger.info(`Filled field ${mapping.configField} with value: ${value}`);
              break;
            }
          } catch (error) {
            // Continue to next selector
          }
        }
      }
    }
  }

  /**
   * Handle file uploads (resume)
   */
  private async handleFileUploads(userConfig: any): Promise<void> {
    if (!this.page || !userConfig.resume_path) return;

    try {
      // Download resume from Supabase
      const resumeBuffer = await supabaseManager.getResumeFile(userConfig.resume_path);
      if (!resumeBuffer) {
        logger.warn('No resume file found, skipping file upload');
        return;
      }

      // Save resume to temporary file
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `resume_${userConfig.id}.pdf`);
      fs.writeFileSync(tempFilePath, Buffer.from(resumeBuffer));

      // Find file input and upload
      const fileInput = await this.page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(tempFilePath);
        logger.info('Resume uploaded successfully');
        
        // Clean up temp file
        fs.unlinkSync(tempFilePath);
      }

    } catch (error) {
      logger.error('Error handling file upload:', error);
    }
  }

  /**
   * Handle dynamic questions using OpenAI
   */
  private async handleDynamicQuestions(userConfig: any): Promise<void> {
    if (!this.page) return;

    try {
      // Find textarea and text input fields that might be questions
      const questionSelectors = [
        'textarea',
        'input[type="text"]:not([name*="name"]):not([name*="email"]):not([name*="phone"])',
        '[data-testid*="question"]',
        '.question textarea',
        '.question input[type="text"]'
      ];

      for (const selector of questionSelectors) {
        const elements = await this.page.$$(selector);
        
        for (const element of elements) {
          try {
            // Get the question context (label, placeholder, etc.)
            const label = await element.evaluate((el: Element) => {
              const labelEl = el.closest('label') || document.querySelector(`label[for="${(el as HTMLElement).id}"]`);
              return labelEl?.textContent?.trim() || (el as HTMLElement).getAttribute('placeholder') || '';
            });

            if (label && label.length > 10) { // Only process if it looks like a question
              // Generate answer using OpenAI
              const aiResponse = await openAIManager.generateAnswer(label, userConfig);
              
              if (aiResponse.answer && aiResponse.answer !== 'Not specified') {
                await element.fill(aiResponse.answer);
                logger.info(`Answered question "${label.substring(0, 50)}..." with AI-generated response`);
              }
            }
          } catch (error) {
            // Continue with next element
            logger.debug('Error processing question element:', error);
          }
        }
      }

    } catch (error) {
      logger.error('Error handling dynamic questions:', error);
    }
  }

  /**
   * Close browser and cleanup
   */
  async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      logger.info('Playwright browser cleaned up successfully');
    } catch (error) {
      logger.error('Error during browser cleanup:', error);
    }
  }
}

export default PlaywrightJobApplicator; 