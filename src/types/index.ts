export interface AutoApplyConfig {
  id: string;
  user_id: string;
  form_id: string;
  created_at: string;
  updated_at: string;

  // Personal Info
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip_code?: string;
  current_job_title?: string;
  current_company?: string;
  current_salary?: string;
  desired_salary?: string;
  notice_period?: string;
  work_auth?: string;
  field_of_study?: string;
  graduation_year?: string;
  linkedin_url?: string;
  website?: string;
  github_url?: string;

  // Resume
  selected_resume_id?: string;
  uploaded_resume_path?: string;

  // App Questions
  legally_authorized?: string;
  require_sponsorship?: string;
  current_location?: string;
  years_experience?: string;
  expected_salary?: string;
  start_date?: string;
  interest_reason?: string;
  key_skills?: string;
  disabilities?: string;
  gender?: string;
  race?: string;
  veteran?: string;

  // Search
  search_terms?: string;
  randomize_search?: boolean;
  search_location?: string;
  experience_level?: string;
  salary_range?: string;
  target_experience?: string;
  preferred_job_types?: string[];
  industries?: string;
  blacklisted_companies?: string;
  whitelisted_companies?: string;
  skip_keywords?: string;
  prioritize_keywords?: string;
  skip_security_clearance?: boolean;
  follow_companies?: boolean;

  // Flags
  resume_ready: boolean;
  use_web_ui: boolean;

  // JSON Data
  skills?: any;
  work_experience?: any;
  education?: any;
  projects?: string;
  certifications?: string;
}

export interface AppliedJob {
  id: string;
  user_id: string;
  job_title: string;
  company_name: string;
  job_url: string;
  applied_at: string;
  status: 'applied' | 'error' | 'skipped' | 'duplicate';
  notes?: string;
  error_message?: string;
  application_data?: any;
}

export interface JobSearchResult {
  title: string;
  company: string;
  location: string;
  url: string;
  description?: string;
  posted_date?: string;
}

export interface FormField {
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file';
  name: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  value?: string;
}

export interface ApplicationResult {
  success: boolean;
  jobUrl: string;
  jobTitle: string;
  companyName: string;
  status: 'applied' | 'error' | 'skipped' | 'duplicate';
  errorMessage?: string;
  notes?: string;
}

export interface OpenAIResponse {
  answer: string;
  confidence: number;
  reasoning?: string;
} 