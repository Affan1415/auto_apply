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
      // Fill all fields using userConfig or OpenAI
      await this.fillAllFieldsWithAI(userConfig);
      // Handle file uploads (resume)
      await this.handleFileUploads(userConfig);
    } catch (error) {
      logger.error('Error filling application form:', error);
      throw error;
    }
  }

  /**
   * Generate a random US phone number
   */
  private generateRandomUSPhoneNumber(): string {
    const area = Math.floor(200 + Math.random() * 800);
    const prefix = Math.floor(200 + Math.random() * 800);
    const line = Math.floor(1000 + Math.random() * 9000);
    return `${area}${prefix}${line}`;
  }

  /**
   * Handle phone input - hardcoded to select United States (+1) and generate US number
   */
  private async handlePhoneInput(): Promise<void> {
    if (!this.page) return;

    try {
      logger.info('Starting phone input handling - selecting United States (+1)...');
      
      // Click the country flag to open dropdown
      await this.page.click('.iti__selected-flag');
      logger.info('Clicked country flag to open dropdown');
      
      // Wait for dropdown to appear
      await this.page.waitForTimeout(1000);
      
      // Select United States (+1) - using the exact selector from the HTML
      await this.page.click('#iti-0__item-us-preferred');
      logger.info('Selected United States (+1) from dropdown');
      
      // Wait for dropdown to close
      await this.page.waitForTimeout(500);
      
      // Generate and fill random US phone number
      const phone = '415-555-2671';

      logger.info(`Generated random US phone number: ${phone}`);
      
      // Use the local robustFill function
      const phoneInput = await this.page.$('input[type="tel"], input[name*="phone"], input[placeholder*="phone"], input[aria-label*="phone"]');
      if (phoneInput) {
        await phoneInput.fill(phone);
        logger.info(`Filled phone input with: ${phone}`);
      } else {
        logger.warn('Could not find phone input field');
      }
      
    } catch (error) {
      logger.warn('Failed to handle phone input with country selector, falling back to basic phone fill');
      // Fallback to basic phone fill
      //const phone = this.generateRandomUSPhoneNumber();
      const phone = '415-555-2671';
      logger.info(`Using fallback phone number: ${phone}`);
      
      const phoneInput = await this.page.$('input[type="tel"], input[name*="phone"], input[placeholder*="phone"], input[aria-label*="phone"]');
      if (phoneInput) {
        await phoneInput.fill(phone);
        logger.info(`Filled phone input with fallback: ${phone}`);
      } else {
        logger.warn('Could not find phone input field for fallback');
      }
    }
  }

  /**
   * Fill all fields using userConfig or OpenAI for missing values
   */
  private async fillAllFieldsWithAI(userConfig: any): Promise<void> {
    if (!this.page) return;

    // Log the full userConfig for debugging
    logger.info('userConfig:', JSON.stringify(userConfig, null, 2));

    // Helper to get value or generate with OpenAI
    const getValue = async (label: string, fallbackKey?: string): Promise<string> => {
      let value = fallbackKey ? userConfig[fallbackKey] : undefined;
      if (!value || value === '') {
        const ai = await openAIManager.generateAnswer(label, userConfig);
        value = ai.answer;
        logger.info(`AI-generated for "${label}": ${value}`);
      } else {
        logger.info(`Filled from userConfig for "${label}": ${value}`);
      }
      return value || '';
    };

    // Helper to dismiss overlays/backdrops/cookie banners
    const dismissOverlays = async () => {
      if (!this.page) return;
      // Try to close cookie consent
      const cookieBtn = await this.page.$('button[data-ui="cookie-consent"], button:has-text("Accept"), button:has-text("Got it")');
      if (cookieBtn) {
        await cookieBtn.click().catch(() => {});
        logger.info('Dismissed cookie consent');
        await this.page.waitForTimeout(500);
      }
      // Try to close backdrop/modal
      const backdrop = await this.page.$('[data-ui="backdrop"], .backdrop, .modal-overlay');
      if (backdrop) {
        await this.page.keyboard.press('Escape').catch(() => {});
        logger.info('Dismissed backdrop/modal with Escape');
        await this.page.waitForTimeout(500);
      }
    };

    // Helper to robustly fill a field by trying label, placeholder, and name
    const robustFill = async (label: string, selectors: string[], value: string) => {
      if (!this.page) {
        logger.warn(`Page is not initialized when trying to fill "${label}"`);
        return false;
      }
      await dismissOverlays();
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await dismissOverlays();
            await element.fill(value);
            logger.info(`Filled field for "${label}" using selector: ${selector} with value: ${value}`);
            return true;
          }
        } catch (error) {
          logger.warn(`Failed to fill field for "${label}" using selector: ${selector}`);
        }
      }
      logger.warn(`Could not find field for "${label}" to fill.`);
      return false;
    };

    // --- Personal Information ---
    // First name, Last name (split full_name, fallback to OpenAI if missing)
    let firstName = '';
    let lastName = '';
    if (userConfig.full_name && typeof userConfig.full_name === 'string') {
      const parts = userConfig.full_name.trim().split(/\s+/);
      firstName = parts[0] || (await getValue('First name'));
      lastName = parts.slice(1).join(' ') || (await getValue('Last name'));
    } else {
      firstName = await getValue('First name');
      lastName = await getValue('Last name');
    }
    await robustFill('First name', [
      'input[name*="first" i]',
      'input[placeholder*="first" i]',
      'input[aria-label*="first" i]',
      'input[autocomplete*="given-name" i]'
    ], firstName);
    await robustFill('Last name', [
      'input[name*="last" i]',
      'input[placeholder*="last" i]',
      'input[aria-label*="last" i]',
      'input[autocomplete*="family-name" i]'
    ], lastName);

    // Email
    const email = userConfig.email || await getValue('Email');
    await robustFill('Email', [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[placeholder*="email" i]'
    ], email);

    // Headline
    const headline = userConfig.current_job_title || userConfig.interest_reason || await getValue('Headline');
    await robustFill('Headline', [
      'input[placeholder*="headline" i]',
      'input[name*="headline" i]',
      'input[aria-label*="headline" i]'
    ], headline);

    // Phone - hardcoded to select United States (+1) and generate US number
    await this.handlePhoneInput();

    // Address
    const address = userConfig.address || await getValue('Address');
    await robustFill('Address', [
      'input[name*="address" i]',
      'input[placeholder*="address" i]',
      'input[aria-label*="address" i]'
    ], address);

    // --- Profile: Education ---
    // let educations = [];
    // if (userConfig.education && Array.isArray(userConfig.education)) {
    //   educations = userConfig.education;
    // } else if (userConfig.education) {
    //   try { educations = JSON.parse(userConfig.education); } catch {}
    // }
    // if (!educations.length) {
    //   const eduAI = await getValue('Education');
    //   educations = [{ degree: eduAI }];
    // }
    // for (const edu of educations) {
    //   // Wait for '+ Add' button to be enabled
    //   const addBtn = await this.page.waitForSelector('button[data-ui="add-section"][aria-label*="Education"]', { timeout: 5000 }).catch(() => null);
    //   if (addBtn) {
    //     const isDisabled = await addBtn.getAttribute('disabled');
    //     if (isDisabled !== null) {
    //       logger.warn('Education "+ Add" button is disabled. Required fields above may not be filled.');
    //     } else {
    //       await addBtn.click();
    //       logger.info('Clicked "+ Add" button for Education');
    //       // Wait for the new input to appear (try common selectors)
    //       const eduInput = await this.page.waitForSelector('input[name*="education" i], input[placeholder*="education" i], input[aria-label*="education" i]', { timeout: 5000 }).catch(() => null);
    //       if (eduInput) {
    //         await eduInput.fill(edu.degree || edu.field || edu.school || '');
    //         logger.info('Filled education input after clicking "+ Add"');
    //       } else {
    //         logger.warn('Could not find education input after clicking "+ Add"');
    //       }
    //     }
    //   } else {
    //     logger.warn('Could not find "+ Add" button for Education');
    //   }
    // }

    // // --- Profile: Experience ---
    // let experiences = [];
    // if (userConfig.work_experience && Array.isArray(userConfig.work_experience)) {
    //   experiences = userConfig.work_experience;
    // } else if (userConfig.work_experience) {
    //   try { experiences = JSON.parse(userConfig.work_experience); } catch {}
    // }
    // if (!experiences.length) {
    //   const expAI = await getValue('Experience');
    //   experiences = [{ position: expAI }];
    // }
    // for (const exp of experiences) {
    //   // Try to click '+ Add' for experience if present
    //   const addBtn = await this.page.$('button[data-ui="add-section"][aria-label*="Experience"]');
    //   if (addBtn) {
    //     const isDisabled = await addBtn.getAttribute('disabled');
    //     if (isDisabled !== null) {
    //       logger.warn('Experience "+ Add" button is disabled. Required fields above may not be filled.');
    //     } else {
    //       await addBtn.click();
    //       logger.info('Clicked "+ Add" button for Experience');
    //       const expInput = await this.page.waitForSelector('input[name*="experience" i], input[placeholder*="experience" i], input[aria-label*="experience" i]', { timeout: 5000 }).catch(() => null);
    //       if (expInput) {
    //         await expInput.fill(exp.position || exp.company || '');
    //         logger.info('Filled experience input after clicking "+ Add"');
    //       } else {
    //         logger.warn('Could not find experience input after clicking "+ Add"');
    //       }
    //     }
    //   } else {
    //     logger.warn('Could not find "+ Add" button for Experience');
    //   }
    // }

    // --- Summary ---
    const summary = userConfig.key_skills || userConfig.interest_reason || await getValue('Summary');
    await robustFill('Summary', [
      'textarea[placeholder*="summary" i]',
      'textarea[name*="summary" i]',
      'textarea[aria-label*="summary" i]'
    ], summary);

    // --- Resume upload is handled separately ---

    // --- Cover letter (always use OpenAI) ---
    const coverLetterAI = await getValue('Cover letter');
    await robustFill('Cover letter', [
      'textarea[placeholder*="cover letter" i]',
      'textarea[name*="cover letter" i]',
      'textarea[aria-label*="cover letter" i]'
    ], coverLetterAI);

    // --- Desired compensation (use config, fallback to OpenAI) ---
    let compensation = userConfig.expected_salary || userConfig.desired_salary;
    if (!compensation) {
      compensation = await getValue('What is your desired compensation for this role?');
    }
    await robustFill('Desired compensation', [
      'input[placeholder*="compensation" i]',
      'textarea[placeholder*="compensation" i]',
      'input[name*="compensation" i]',
      'textarea[name*="compensation" i]',
      'input[aria-label*="compensation" i]',
      'textarea[aria-label*="compensation" i]'
    ], compensation);

    // --- Commute/relocate (use config, fallback to OpenAI) ---
    let relocate = userConfig.relocation || userConfig.commute;
    if (!relocate) {
      relocate = await getValue('Are you currently able to commute to this location, or are you willing to relocate for this role?');
    }
    await robustFill('Commute/relocate', [
      'textarea[placeholder*="commute" i]',
      'textarea[placeholder*="relocate" i]',
      'textarea[name*="commute" i]',
      'textarea[name*="relocate" i]',
      'textarea[aria-label*="commute" i]',
      'textarea[aria-label*="relocate" i]'
    ], relocate);

    // Handle remaining fields and yes/no selectors
    await this.handleRemainingFieldsAndYesNoSelectors();
  }

  /**
   * Handle remaining input fields and yes/no selectors
   */
  private async handleRemainingFieldsAndYesNoSelectors(): Promise<void> {
    if (!this.page) return;

    try {
      logger.info('Handling remaining fields and yes/no selectors...');

      // Helper to dismiss overlays
      const dismissOverlays = async () => {
        if (!this.page) return;
        const cookieBtn = await this.page.$('button[data-ui="cookie-consent"], button:has-text("Accept"), button:has-text("Got it")');
        if (cookieBtn) {
          await cookieBtn.click().catch(() => {});
          await this.page.waitForTimeout(500);
        }
        const backdrop = await this.page.$('[data-ui="backdrop"], .backdrop, .modal-overlay');
        if (backdrop) {
          await this.page.keyboard.press('Escape').catch(() => {});
          await this.page.waitForTimeout(500);
        }
      };

      // 1. Handle Yes/No selectors (radio buttons, checkboxes, dropdowns)
      const yesNoSelectors = [
        'input[type="radio"][value*="yes" i]',
        'input[type="radio"][value*="true" i]',
        'input[type="radio"][value="1"]',
        'input[type="radio"][value="Yes"]',
        'input[type="radio"][value="YES"]',
        'input[type="checkbox"]',
        'select option[value*="yes" i]',
        'select option[value*="true" i]',
        'select option[value="1"]',
        'select option[value="Yes"]',
        'select option[value="YES"]',
        'button[data-value*="yes" i]',
        'button[data-value*="true" i]',
        'button[data-value="1"]',
        'button[data-value="Yes"]',
        'button[data-value="YES"]',
        '[data-testid*="yes" i]',
        '[data-testid*="true" i]',
        '.yes-option',
        '.true-option',
        // More specific selectors for authorization questions
        'input[type="radio"]:not([value*="no" i]):not([value*="false" i]):not([value="0"]):not([value="No"]):not([value="NO"])',
        'input[type="radio"][value*="authorized" i]',
        'input[type="radio"][value*="eligible" i]',
        'input[type="radio"][value*="sponsorship" i]',
        'input[type="radio"][value*="work" i]',
        'input[type="radio"][value*="legal" i]'
      ];

      for (const selector of yesNoSelectors) {
        try {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            await dismissOverlays();
            
            // Check if it's a radio button or checkbox
            const tagName = await element.evaluate(el => el.tagName.toLowerCase());
            const type = await element.evaluate(el => (el as HTMLInputElement).type);
            
            if (tagName === 'input' && (type === 'radio' || type === 'checkbox')) {
              // For radio buttons, check if it's already selected
              const isChecked = await element.evaluate(el => (el as HTMLInputElement).checked);
              if (!isChecked) {
                await element.click();
                logger.info(`Clicked yes/true option: ${selector}`);
              }
            } else if (tagName === 'option') {
              // For select options, click the parent select and then the option
              const select = await element.evaluate(el => el.parentElement);
              if (select) {
                await this.page.click(selector);
                logger.info(`Selected yes/true option: ${selector}`);
              }
            } else {
              // For other elements, just click
              await element.click();
              logger.info(`Clicked yes/true option: ${selector}`);
            }
          }
        } catch (error) {
          logger.debug(`Failed to handle selector ${selector}:`, error);
        }
      }

      // 1.5. Handle radio button groups more comprehensively
      try {
        const radioGroups = await this.page.$$('input[type="radio"]');
        const processedGroups = new Set();
        
        for (const radio of radioGroups) {
          const name = await radio.evaluate(el => (el as HTMLInputElement).name);
          if (name && !processedGroups.has(name)) {
            processedGroups.add(name);
            
            // Get all radios in this group
            const groupRadios = await this.page.$$(`input[type="radio"][name="${name}"]`);
            
            // Find the "Yes" option in this group
            let yesOption = null;
            for (const groupRadio of groupRadios) {
              const value = await groupRadio.evaluate(el => (el as HTMLInputElement).value);
              const text = await groupRadio.evaluate(el => {
                const label = document.querySelector(`label[for="${el.id}"]`);
                return label?.textContent?.trim() || '';
              });
              
              // Check if this is a "Yes" option
              if (value?.toLowerCase().includes('yes') || 
                  value?.toLowerCase().includes('true') ||
                  value === '1' ||
                  value === 'Yes' ||
                  value === 'YES' ||
                  text?.toLowerCase().includes('yes') ||
                  text?.toLowerCase().includes('true')) {
                yesOption = groupRadio;
                break;
              }
            }
            
            // If no "Yes" option found, select the first option that's not "No"
            if (!yesOption) {
              for (const groupRadio of groupRadios) {
                const value = await groupRadio.evaluate(el => (el as HTMLInputElement).value);
                const text = await groupRadio.evaluate(el => {
                  const label = document.querySelector(`label[for="${el.id}"]`);
                  return label?.textContent?.trim() || '';
                });
                
                if (!value?.toLowerCase().includes('no') && 
                    !value?.toLowerCase().includes('false') &&
                    value !== '0' &&
                    value !== 'No' &&
                    value !== 'NO' &&
                    !text?.toLowerCase().includes('no') &&
                    !text?.toLowerCase().includes('false')) {
                  yesOption = groupRadio;
                  break;
                }
              }
            }
            
            // Click the selected option
            if (yesOption) {
              const isChecked = await yesOption.evaluate(el => (el as HTMLInputElement).checked);
              if (!isChecked) {
                await yesOption.click();
                logger.info(`Selected "Yes" option in radio group: ${name}`);
              }
            }
          }
        }
      } catch (error) {
        logger.debug('Failed to handle radio button groups:', error);
      }

      // 2. Handle remaining text inputs and textareas with "yes"
      const remainingTextSelectors = [
        'input[type="text"]:not([name*="name"]):not([name*="email"]):not([name*="phone"]):not([name*="address"]):not([name*="headline"]):not([name*="compensation"]):not([name*="relocate"]):not([name*="commute"])',
        'textarea:not([placeholder*="cover letter"]):not([placeholder*="summary"]):not([placeholder*="compensation"]):not([placeholder*="relocate"]):not([placeholder*="commute"])',
        'input[type="text"]:not([value])',
        'textarea:not([value])'
      ];

      for (const selector of remainingTextSelectors) {
        try {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            await dismissOverlays();
            
            // Check if the field is empty
            const value = await element.evaluate(el => (el as HTMLInputElement | HTMLTextAreaElement).value);
            const placeholder = await element.evaluate(el => (el as HTMLInputElement | HTMLTextAreaElement).placeholder);
            
            if (!value && !placeholder?.includes('cover letter') && !placeholder?.includes('summary')) {
              await element.fill('yes');
              logger.info(`Filled remaining field with "yes": ${selector}`);
            }
          }
        } catch (error) {
          logger.debug(`Failed to fill remaining field ${selector}:`, error);
        }
      }

      // 3. Handle dropdowns and select elements
      const dropdownSelectors = [
        'select:not([name*="name"]):not([name*="email"]):not([name*="phone"]):not([name*="address"])',
        'select option[value*="yes" i]',
        'select option[value*="true" i]',
        'select option[value="1"]',
        'select option:first-child'
      ];

      for (const selector of dropdownSelectors) {
        try {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            await dismissOverlays();
            
            const tagName = await element.evaluate(el => el.tagName.toLowerCase());
            if (tagName === 'select') {
              // Try to select the first option or a "yes" option
              const options = await element.$$('option');
              if (options.length > 0) {
                // Look for yes/true options first
                let selectedOption = null;
                for (const option of options) {
                  const optionValue = await option.evaluate(el => (el as HTMLOptionElement).value);
                  const optionText = await option.evaluate(el => (el as HTMLOptionElement).textContent);
                  if (optionValue?.toLowerCase().includes('yes') || 
                      optionText?.toLowerCase().includes('yes') ||
                      optionValue?.toLowerCase().includes('true') ||
                      optionText?.toLowerCase().includes('true') ||
                      optionValue === '1') {
                    selectedOption = option;
                    break;
                  }
                }
                
                // If no yes option found, select the first option
                if (!selectedOption && options.length > 0) {
                  selectedOption = options[0];
                }
                
                if (selectedOption) {
                  await selectedOption.click();
                  logger.info(`Selected dropdown option: ${selector}`);
                }
              }
            }
          }
        } catch (error) {
          logger.debug(`Failed to handle dropdown ${selector}:`, error);
        }
      }

      // 4. Handle specific authorization and eligibility questions
      try {
        const authorizationSelectors = [
          'input[type="radio"]',
          'input[type="checkbox"]',
          'select',
          'button[data-value]'
        ];

        for (const selector of authorizationSelectors) {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            await dismissOverlays();
            
            // Get the context around this element to check if it's an authorization question
            const context = await element.evaluate(el => {
              // Look for nearby text that might indicate this is an authorization question
              const parent = el.parentElement;
              const grandparent = parent?.parentElement;
              const text = [
                parent?.textContent,
                grandparent?.textContent,
                document.querySelector(`label[for="${el.id}"]`)?.textContent,
                el.closest('div')?.textContent,
                el.closest('section')?.textContent
              ].join(' ').toLowerCase();
              
              return {
                text,
                tagName: el.tagName.toLowerCase(),
                type: (el as HTMLInputElement).type,
                value: (el as HTMLInputElement).value,
                name: (el as HTMLInputElement).name
              };
            });
            
            // Check if this looks like an authorization question
            const authKeywords = [
              'authorized', 'authorization', 'legally', 'legal', 'sponsorship', 
              'sponsor', 'work permit', 'visa', 'citizenship', 'eligible', 
              'eligibility', 'work authorization', 'employment authorization',
              'legally authorized to work', 'without sponsorship'
            ];
            
            const isAuthQuestion = authKeywords.some(keyword => 
              context.text.includes(keyword)
            );
            
            if (isAuthQuestion) {
              logger.info(`Found authorization question: ${context.text.substring(0, 100)}...`);
              
              if (context.tagName === 'input' && context.type === 'radio') {
                // For radio buttons, select the "Yes" option
                const value = context.value;
                const text = context.text;
                
                if (value?.toLowerCase().includes('yes') || 
                    value?.toLowerCase().includes('true') ||
                    value === '1' ||
                    value === 'Yes' ||
                    value === 'YES' ||
                    text?.toLowerCase().includes('yes') ||
                    text?.toLowerCase().includes('true')) {
                  const isChecked = await element.evaluate(el => (el as HTMLInputElement).checked);
                  if (!isChecked) {
                    await element.click();
                    logger.info(`Selected "Yes" for authorization question`);
                  }
                }
              } else if (context.tagName === 'select') {
                // For select elements, choose the first "Yes" option
                const options = await element.$$('option');
                for (const option of options) {
                  const optionValue = await option.evaluate(el => (el as HTMLOptionElement).value);
                  const optionText = await option.evaluate(el => (el as HTMLOptionElement).textContent);
                  
                  if (optionValue?.toLowerCase().includes('yes') || 
                      optionText?.toLowerCase().includes('yes') ||
                      optionValue?.toLowerCase().includes('true') ||
                      optionText?.toLowerCase().includes('true')) {
                    await option.click();
                    logger.info(`Selected "Yes" option for authorization question`);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        logger.debug('Failed to handle authorization questions:', error);
      }

      logger.info('Completed handling remaining fields and yes/no selectors');
    } catch (error) {
      logger.error('Error handling remaining fields and yes/no selectors:', error);
    }
  }

  /**
   * Improved submit logic: check for validation errors and log result
   */
  private async improvedSubmit(): Promise<boolean> {
    if (!this.page) return false;
    // Try multiple selectors for the submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit application")',
      'button:has-text("Submit")',
      'button:has-text("Apply")'
    ];
    for (const selector of submitSelectors) {
      const button = await this.page.$(selector);
      if (button) {
        await button.click();
        logger.info(`Clicked submit button using selector: ${selector}`);
        // Wait for possible validation errors
        await this.page.waitForTimeout(2000);
        // Check for error messages
        const errorMsg = await this.page.$('.error, .form-error, [aria-live="assertive"]');
        if (errorMsg) {
          const text = await errorMsg.textContent();
          logger.warn(`Validation error after submit: ${text}`);
          return false;
        }
        logger.info('Form submitted (no validation errors detected)');
        return true;
      }
    }
    logger.warn('No submit button found');
    return false;
  }

  /**
   * Handle file uploads (resume)
   */
  private async handleFileUploads(userConfig: any): Promise<void> {
    if (!this.page) return;

    try {
      let resumePath = null;

      // Check if user has selected_resume_id
      if (userConfig.selected_resume_id) {
        logger.info(`User has selected resume ID: ${userConfig.selected_resume_id}`);
        
        // Get resume data from database
        const resumeData = await supabaseManager.getResumeById(userConfig.selected_resume_id);
        if (resumeData) {
          logger.info(`Found resume data for: ${resumeData.first_name} ${resumeData.last_name}`);
          
          // Generate PDF from resume data and upload to storage
          resumePath = await supabaseManager.generateAndUploadResumePDF(resumeData);
          logger.info(`Generated and uploaded resume PDF: ${resumePath}`);
        } else {
          logger.warn(`No resume data found for ID: ${userConfig.selected_resume_id}`);
        }
      } else if (userConfig.resume_path) {
        // Fallback to existing resume_path
        resumePath = userConfig.resume_path;
        logger.info(`Using existing resume path: ${resumePath}`);
      }

      if (!resumePath) {
        logger.warn('No resume available, creating empty PDF as fallback');
        
        // Create empty PDF as fallback
        try {
          resumePath = await supabaseManager.generateAndUploadEmptyPDF(userConfig.id);
          logger.info(`Created and uploaded empty resume PDF: ${resumePath}`);
        } catch (error) {
          logger.error('Failed to create empty PDF:', error);
          return;
        }
      }

      // Download resume from Supabase
      const resumeBuffer = await supabaseManager.getResumeFile(resumePath);
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

      // Enhanced file input detection for Workable forms
      const fileInputSelectors = [
        'input[type="file"]',
        'input[data-ui="resume"]',
        'input[accept*="pdf"]',
        'input[accept*="doc"]',
        'input[accept*="docx"]',
        'input[accept*=".pdf,.doc,.docx"]',
        'input[aria-labelledby*="resume"]',
        'input[id*="resume"]',
        'input[name*="resume"]',
        'input[class*="file"]',
        'input[class*="upload"]',
        // Workable specific selectors based on the HTML structure
        'input[data-ui="resume"]',
        'input[id*="input_files_input"]',
        'input[class*="styles__hidden-file-input"]',
        'input[accept*="application/pdf"]',
        'input[accept*="application/msword"]',
        'input[accept*="application/vnd.openxmlformats-officedocument.wordprocessingml.document"]'
      ];

      let fileInput = null;
      for (const selector of fileInputSelectors) {
        try {
          fileInput = await this.page.$(selector);
          if (fileInput) {
            logger.info(`Found file input using selector: ${selector}`);
            break;
          }
        } catch (error) {
          logger.debug(`Selector ${selector} failed:`, error);
        }
      }

      if (fileInput) {
        // Wait for file input to be ready
        await this.page.waitForTimeout(1000);
        
        // Try to upload the file
        try {
          await fileInput.setInputFiles(tempFilePath);
          logger.info('Resume uploaded successfully using setInputFiles');
          
          // Wait for upload to complete and check for success indicators
          await this.page.waitForTimeout(2000);
          
          // Check if file was uploaded successfully by looking for success indicators
          const successIndicators = await this.page.$$('.styles__preview--QXE0e, .file-upload-success, .upload-success, [data-role="preview"]');
          if (successIndicators.length > 0) {
            logger.info('File upload confirmed by success indicators');
          } else {
            logger.warn('No success indicators found after file upload');
          }
          
        } catch (uploadError) {
          logger.warn('setInputFiles failed, trying alternative upload method:', uploadError);
          
          // Try clicking the dropzone first (Workable specific)
          try {
            const dropzone = await this.page.$('[data-role="dropzone"], .styles__droparea--1L916, .styles__dropzone--ZvWLm');
            if (dropzone) {
              await dropzone.click();
              logger.info('Clicked dropzone to activate file input');
              await this.page.waitForTimeout(1000);
              
              // Try uploading again after clicking dropzone
              await fileInput.setInputFiles(tempFilePath);
              logger.info('Resume uploaded successfully after clicking dropzone');
            }
          } catch (dropzoneError) {
            logger.warn('Dropzone click failed:', dropzoneError);
          }
          
          // Alternative method: use evaluate to set files
          try {
            await this.page.evaluate((filePath) => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement;
              if (input) {
                // Create a FileList-like object
                const dataTransfer = new DataTransfer();
                // Note: This won't work with actual file path, but worth trying
                const file = new File([''], 'resume.pdf', { type: 'application/pdf' });
                dataTransfer.items.add(file);
                input.files = dataTransfer.files;
                
                // Trigger change event
                const event = new Event('change', { bubbles: true });
                input.dispatchEvent(event);
              }
            }, tempFilePath);
            logger.info('Tried alternative file upload method');
          } catch (altError) {
            logger.error('Alternative upload method also failed:', altError);
          }
        }
        
        // Clean up temp file
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          logger.warn('Failed to clean up temp file:', cleanupError);
        }
              } else {
          logger.warn('No file input found for resume upload. Trying to trigger upload button...');
          
          // Try clicking the upload button to trigger file input
          try {
            const uploadButton = await this.page.$('label[for*="input_files_input"], button:has-text("Upload"), label:has-text("Upload a file")');
            if (uploadButton) {
              await uploadButton.click();
              logger.info('Clicked upload button to trigger file input');
              await this.page.waitForTimeout(1000);
              
              // Try to find file input again after clicking button
              const triggeredFileInput = await this.page.$('input[type="file"]');
              if (triggeredFileInput) {
                await triggeredFileInput.setInputFiles(tempFilePath);
                logger.info('Resume uploaded successfully after triggering upload button');
              } else {
                logger.warn('File input still not found after clicking upload button');
              }
            } else {
              logger.warn('No upload button found');
            }
          } catch (buttonError) {
            logger.warn('Failed to click upload button:', buttonError);
          }
          
          // Log all file inputs for debugging
          const allFileInputs = await this.page.$$('input[type="file"]');
          for (let i = 0; i < allFileInputs.length; i++) {
            const input = allFileInputs[i];
            if (input) {
              const attributes = await input.evaluate((el) => {
                const htmlEl = el as HTMLInputElement;
                return {
                  id: htmlEl.id,
                  name: htmlEl.name,
                  class: htmlEl.className,
                  accept: htmlEl.accept,
                  'data-ui': htmlEl.getAttribute('data-ui'),
                  'aria-labelledby': htmlEl.getAttribute('aria-labelledby')
                };
              });
              logger.info(`File input ${i + 1}:`, attributes);
            }
          }
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