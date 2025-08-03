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

  /**
   * Get resume data by ID
   */
  async getResumeById(resumeId: string): Promise<any> {
    try {
      const { data, error } = await this.client
        .from('resumes')
        .select('*')
        .eq('id', resumeId)
        .single();

      if (error) {
        logger.error('Error fetching resume by ID:', error);
        throw error;
      }

      logger.info(`Successfully fetched resume: ${data?.name || 'Unknown'}`);
      return data;
    } catch (error) {
      logger.error('Failed to get resume by ID:', error);
      throw error;
    }
  }

  /**
   * Generate PDF from resume data and upload to storage
   */
  async generateAndUploadResumePDF(resumeData: any): Promise<string> {
    return this.generateAndUploadPDF(this.generateResumeHTML(resumeData), `resume_${resumeData.id}_${Date.now()}.pdf`);
  }

  /**
   * Generate empty PDF and upload to storage
   */
  async generateAndUploadEmptyPDF(userId: string): Promise<string> {
    const emptyHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Resume</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            text-align: center;
          }
          .empty-resume {
            margin-top: 100px;
            color: #666;
          }
          .title {
            font-size: 24px;
            margin-bottom: 20px;
          }
          .subtitle {
            font-size: 16px;
            color: #888;
          }
        </style>
      </head>
      <body>
        <div class="empty-resume">
          <div class="title">Resume</div>
          <div class="subtitle">Auto-generated empty resume</div>
        </div>
      </body>
      </html>
    `;
    
    return this.generateAndUploadPDF(emptyHtml, `empty_resume_${userId}_${Date.now()}.pdf`);
  }

  /**
   * Generate PDF from HTML and upload to storage
   */
  private async generateAndUploadPDF(htmlContent: string, fileName: string): Promise<string> {
    try {
      // Import PDF generation library
      const puppeteer = require('puppeteer');
      
      // Launch browser and generate PDF
      const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      
      // Set content and generate PDF
      await page.setContent(htmlContent);
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });
      
      await browser.close();
      
      // Upload PDF to Supabase storage
      const { data, error } = await this.client.storage
        .from('resumes')
        .upload(fileName, pdfBuffer, {
          contentType: 'application/pdf'
        });

      if (error) {
        logger.error('Error uploading PDF:', error);
        throw error;
      }

      logger.info(`Successfully uploaded PDF: ${fileName}`);
      return fileName;
    } catch (error) {
      logger.error('Failed to generate and upload PDF:', error);
      throw error;
    }
  }

  /**
   * Generate HTML content for resume
   */
  private generateResumeHTML(resumeData: any): string {
    const {
      first_name,
      last_name,
      email,
      phone_number,
      location,
      website,
      linkedin_url,
      github_url,
      professional_summary,
      work_experience,
      education,
      skills,
      projects,
      certifications,
      target_role
    } = resumeData;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${first_name} ${last_name} - Resume</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
            margin-bottom: 20px;
          }
          .name {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .title {
            font-size: 18px;
            color: #666;
            margin-bottom: 15px;
          }
          .contact-info {
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 20px;
            margin-bottom: 20px;
          }
          .contact-item {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .section {
            margin-bottom: 25px;
          }
          .section-title {
            font-size: 20px;
            font-weight: bold;
            border-bottom: 1px solid #ccc;
            padding-bottom: 5px;
            margin-bottom: 15px;
          }
          .experience-item, .education-item, .project-item {
            margin-bottom: 15px;
          }
          .job-title, .degree, .project-name {
            font-weight: bold;
            font-size: 16px;
          }
          .company, .school, .project-tech {
            color: #666;
            font-style: italic;
          }
          .date {
            color: #888;
            font-size: 14px;
          }
          .skills-list {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
          }
          .skill {
            background: #f0f0f0;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="name">${first_name} ${last_name}</div>
          ${target_role ? `<div class="title">${target_role}</div>` : ''}
          <div class="contact-info">
            ${email ? `<div class="contact-item">📧 ${email}</div>` : ''}
            ${phone_number ? `<div class="contact-item">📞 ${phone_number}</div>` : ''}
            ${location ? `<div class="contact-item">📍 ${location}</div>` : ''}
            ${website ? `<div class="contact-item">🌐 ${website}</div>` : ''}
            ${linkedin_url ? `<div class="contact-item">💼 ${linkedin_url}</div>` : ''}
            ${github_url ? `<div class="contact-item">🐙 ${github_url}</div>` : ''}
          </div>
        </div>

        ${professional_summary ? `
        <div class="section">
          <div class="section-title">Professional Summary</div>
          <p>${professional_summary}</p>
        </div>
        ` : ''}

        ${work_experience ? `
        <div class="section">
          <div class="section-title">Work Experience</div>
          ${this.formatWorkExperience(work_experience)}
        </div>
        ` : ''}

        ${education ? `
        <div class="section">
          <div class="section-title">Education</div>
          ${this.formatEducation(education)}
        </div>
        ` : ''}

        ${skills ? `
        <div class="section">
          <div class="section-title">Skills</div>
          <div class="skills-list">
            ${this.formatSkills(skills)}
          </div>
        </div>
        ` : ''}

        ${projects ? `
        <div class="section">
          <div class="section-title">Projects</div>
          ${this.formatProjects(projects)}
        </div>
        ` : ''}

        ${certifications ? `
        <div class="section">
          <div class="section-title">Certifications</div>
          ${this.formatCertifications(certifications)}
        </div>
        ` : ''}
      </body>
      </html>
    `;
  }

  /**
   * Format work experience for HTML
   */
  private formatWorkExperience(workExperience: any): string {
    if (typeof workExperience === 'string') {
      try {
        workExperience = JSON.parse(workExperience);
      } catch {
        return `<p>${workExperience}</p>`;
      }
    }

    if (Array.isArray(workExperience)) {
      return workExperience.map(exp => `
        <div class="experience-item">
          <div class="job-title">${exp.title || exp.position || 'Position'}</div>
          <div class="company">${exp.company || exp.employer || 'Company'}</div>
          <div class="date">${exp.start_date || ''} - ${exp.end_date || 'Present'}</div>
          <p>${exp.description || exp.responsibilities || ''}</p>
        </div>
      `).join('');
    }

    return `<p>${workExperience}</p>`;
  }

  /**
   * Format education for HTML
   */
  private formatEducation(education: any): string {
    if (typeof education === 'string') {
      try {
        education = JSON.parse(education);
      } catch {
        return `<p>${education}</p>`;
      }
    }

    if (Array.isArray(education)) {
      return education.map(edu => `
        <div class="education-item">
          <div class="degree">${edu.degree || edu.field || 'Degree'}</div>
          <div class="school">${edu.school || edu.institution || 'Institution'}</div>
          <div class="date">${edu.graduation_date || edu.year || ''}</div>
          <p>${edu.description || ''}</p>
        </div>
      `).join('');
    }

    return `<p>${education}</p>`;
  }

  /**
   * Format skills for HTML
   */
  private formatSkills(skills: any): string {
    if (typeof skills === 'string') {
      try {
        skills = JSON.parse(skills);
      } catch {
        skills = skills.split(',').map((s: string) => s.trim());
      }
    }

    if (Array.isArray(skills)) {
      return skills.map(skill => `<span class="skill">${skill}</span>`).join('');
    }

    return `<span class="skill">${skills}</span>`;
  }

  /**
   * Format projects for HTML
   */
  private formatProjects(projects: any): string {
    if (typeof projects === 'string') {
      try {
        projects = JSON.parse(projects);
      } catch {
        return `<p>${projects}</p>`;
      }
    }

    if (Array.isArray(projects)) {
      return projects.map(project => `
        <div class="project-item">
          <div class="project-name">${project.name || project.title || 'Project'}</div>
          <div class="project-tech">${project.technologies || project.tech || ''}</div>
          <p>${project.description || ''}</p>
        </div>
      `).join('');
    }

    return `<p>${projects}</p>`;
  }

  /**
   * Format certifications for HTML
   */
  private formatCertifications(certifications: any): string {
    if (typeof certifications === 'string') {
      try {
        certifications = JSON.parse(certifications);
      } catch {
        return `<p>${certifications}</p>`;
      }
    }

    if (Array.isArray(certifications)) {
      return certifications.map(cert => `
        <div class="project-item">
          <div class="project-name">${cert.name || cert.title || 'Certification'}</div>
          <div class="project-tech">${cert.issuer || cert.organization || ''}</div>
          <div class="date">${cert.date || cert.issued_date || ''}</div>
        </div>
      `).join('');
    }

    return `<p>${certifications}</p>`;
  }
}

// Create and export a singleton instance
const supabaseManager = new SupabaseManager();
export default supabaseManager; 