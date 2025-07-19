import OpenAI from 'openai';
import { AutoApplyConfig, OpenAIResponse } from './types';
import logger from './utils/logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class OpenAIManager {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.');
    }

    this.client = new OpenAI({
      apiKey: apiKey,
    });
    
    logger.info('OpenAI client initialized');
  }

  /**
   * Generate a system prompt from user profile
   */
  private createSystemPrompt(userConfig: AutoApplyConfig): string {
    const profile = {
      personal: {
        name: userConfig.full_name,
        email: userConfig.email,
        phone: userConfig.phone,
        location: `${userConfig.city}, ${userConfig.state}, ${userConfig.country}`,
        currentJob: userConfig.current_job_title,
        currentCompany: userConfig.current_company,
        desiredSalary: userConfig.desired_salary,
        workAuth: userConfig.work_auth,
        linkedin: userConfig.linkedin_url,
        github: userConfig.github_url,
        website: userConfig.website
      },
      experience: {
        years: userConfig.years_experience,
        skills: userConfig.key_skills,
        workHistory: userConfig.work_experience,
        education: userConfig.education,
        fieldOfStudy: userConfig.field_of_study,
        graduationYear: userConfig.graduation_year
      },
      preferences: {
        targetExperience: userConfig.target_experience,
        preferredJobTypes: userConfig.preferred_job_types,
        industries: userConfig.industries,
        salaryRange: userConfig.salary_range,
        noticePeriod: userConfig.notice_period,
        startDate: userConfig.start_date
      },
      additional: {
        projects: userConfig.projects,
        certifications: userConfig.certifications,
        interestReason: userConfig.interest_reason,
        disabilities: userConfig.disabilities,
        gender: userConfig.gender,
        race: userConfig.race,
        veteran: userConfig.veteran
      }
    };

    return `You are an AI assistant helping a job applicant fill out job application forms. 

The applicant's profile is:
${JSON.stringify(profile, null, 2)}

IMPORTANT GUIDELINES:
1. Always be truthful and accurate based on the provided profile
2. Keep answers concise but professional
3. If information is not available in the profile, say "Not specified" or provide a reasonable default
4. For salary questions, use the desired_salary if available, otherwise be conservative
5. For experience questions, use the years_experience and work_experience data
6. For skills questions, use the key_skills and skills data
7. For location questions, use the current location information
8. For work authorization, use the work_auth information
9. Always maintain a professional tone
10. If asked about availability, use the notice_period and start_date information

Respond with a JSON object containing:
{
  "answer": "the actual answer to the question",
  "confidence": 0.95,
  "reasoning": "brief explanation of why this answer was chosen"
}`;
  }

  /**
   * Generate an answer for a form question using the user's profile
   */
  async generateAnswer(
    question: string, 
    userConfig: AutoApplyConfig,
    context?: string
  ): Promise<OpenAIResponse> {
    try {
      const systemPrompt = this.createSystemPrompt(userConfig);
      
      const userPrompt = context 
        ? `Context: ${context}\n\nQuestion: ${question}`
        : `Question: ${question}`;

      const completion = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        throw new Error('No response received from OpenAI');
      }

      // Try to parse as JSON first
      try {
        const parsedResponse = JSON.parse(response);
        return {
          answer: parsedResponse.answer,
          confidence: parsedResponse.confidence || 0.8,
          reasoning: parsedResponse.reasoning
        };
      } catch (parseError) {
        // If JSON parsing fails, treat the entire response as the answer
        logger.warn('Failed to parse OpenAI response as JSON, using raw response');
        return {
          answer: response.trim(),
          confidence: 0.7,
          reasoning: 'Raw response used due to JSON parsing failure'
        };
      }

    } catch (error) {
      logger.error('Error generating answer with OpenAI:', error);
      
      // Return a fallback response
      return {
        answer: 'Not specified',
        confidence: 0.0,
        reasoning: 'Error occurred while generating answer'
      };
    }
  }

  /**
   * Generate a cover letter or motivation statement
   */
  async generateCoverLetter(
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    userConfig: AutoApplyConfig
  ): Promise<string> {
    try {
      const systemPrompt = this.createSystemPrompt(userConfig);
      
      const userPrompt = `Generate a brief, professional cover letter for the following job:

Job Title: ${jobTitle}
Company: ${companyName}
Job Description: ${jobDescription}

Keep it under 200 words and focus on relevant experience and skills.`;

      const completion = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: 0.4,
        max_tokens: 300,
      });

      const response = completion.choices[0]?.message?.content;
      return response?.trim() || 'Thank you for considering my application.';
      
    } catch (error) {
      logger.error('Error generating cover letter:', error);
      return 'Thank you for considering my application.';
    }
  }

  /**
   * Analyze job description and extract key requirements
   */
  async analyzeJobDescription(jobDescription: string): Promise<{
    requiredSkills: string[];
    preferredSkills: string[];
    experienceLevel: string;
    salaryRange?: string;
  }> {
    try {
      const completion = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an AI assistant that analyzes job descriptions and extracts key information. Return your response as JSON.`
          },
          {
            role: "user",
            content: `Analyze this job description and extract:
1. Required skills (technical and soft skills)
2. Preferred skills
3. Experience level (entry, mid, senior, etc.)
4. Salary range if mentioned

Job Description: ${jobDescription}

Return as JSON:
{
  "requiredSkills": ["skill1", "skill2"],
  "preferredSkills": ["skill1", "skill2"],
  "experienceLevel": "entry|mid|senior",
  "salaryRange": "range if mentioned"
}`
          }
        ],
        temperature: 0.2,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        throw new Error('No response received from OpenAI');
      }

      try {
        return JSON.parse(response);
      } catch (parseError) {
        logger.warn('Failed to parse job analysis response as JSON');
        return {
          requiredSkills: [],
          preferredSkills: [],
          experienceLevel: 'unknown'
        };
      }

    } catch (error) {
      logger.error('Error analyzing job description:', error);
      return {
        requiredSkills: [],
        preferredSkills: [],
        experienceLevel: 'unknown'
      };
    }
  }
}

// Create and export a singleton instance
const openAIManager = new OpenAIManager();
export default openAIManager; 