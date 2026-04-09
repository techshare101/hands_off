// 🎬 SKILL RECORDER — Record browser actions once, replay them forever
// Watch mode: captures user's clicks, types, scrolls as they happen
// Replay mode: re-executes the recorded steps with the agent
// Users can manually create, edit, and share skills

import { ActionSchema } from './prompts';
import { autoSkill, Skill, SkillStep, SkillMetadata, SkillTrigger } from './autoSkill';

const STORAGE_KEY_RECORDINGS = 'handoff_recordings';
const MAX_RECORDINGS = 50;

// ── Types ───────────────────────────────────────────────────────────

export interface RecordingSession {
  id: string;
  name: string;
  description: string;
  startUrl: string;
  startedAt: number;
  endedAt?: number;
  steps: RecordedStep[];
  status: 'recording' | 'paused' | 'completed' | 'cancelled';
  variables: SkillVariable[]; // user-defined variables for replay
}

export interface RecordedStep {
  order: number;
  action: ActionSchema;
  timestamp: number;
  pageUrl: string;
  pageTitle: string;
  elementSelector?: string; // CSS selector if we can infer it
  screenshot?: string; // thumbnail of the step (base64)
  note?: string; // user annotation
}

export interface SkillVariable {
  name: string; // e.g. "search_query", "email"
  description: string;
  defaultValue?: string;
  required: boolean;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  steps: SkillTemplateStep[];
  variables: SkillVariable[];
  startUrl: string;
  sitePattern: string; // URL pattern this skill applies to
  tags: string[];
  author: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface SkillTemplateStep {
  order: number;
  action: ActionSchema;
  description: string;
  waitAfterMs: number;
  isOptional: boolean;
  condition?: string; // when to execute this step
}

export type SkillCategory = 
  | 'form-filling'
  | 'search'
  | 'data-extraction'
  | 'navigation'
  | 'social-media'
  | 'shopping'
  | 'job-application'
  | 'finance'
  | 'productivity'
  | 'custom';

// ── Built-in Skill Templates ────────────────────────────────────────
// Pre-built skills users can install with one click

export const BUILT_IN_TEMPLATES: SkillTemplate[] = [
  {
    id: 'tpl_google_search',
    name: 'Google Search & Extract',
    description: 'Search Google and extract the top results',
    category: 'search',
    startUrl: 'https://www.google.com',
    sitePattern: 'google.com',
    tags: ['search', 'google', 'research'],
    author: 'HandOff',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: [
      { name: 'query', description: 'Search query', required: true },
    ],
    steps: [
      { order: 1, action: { type: 'click', x: 580, y: 340, confidence: 0.9 }, description: 'Click search box', waitAfterMs: 300, isOptional: false },
      { order: 2, action: { type: 'type', x: 580, y: 340, text: '{{query}}', confidence: 0.9 }, description: 'Type search query', waitAfterMs: 200, isOptional: false },
      { order: 3, action: { type: 'press', x: 580, y: 340, key: 'Enter', confidence: 0.9 }, description: 'Press Enter to search', waitAfterMs: 2000, isOptional: false },
    ],
  },
  {
    id: 'tpl_linkedin_job_search',
    name: 'LinkedIn Job Search',
    description: 'Search for jobs on LinkedIn with filters',
    category: 'job-application',
    startUrl: 'https://www.linkedin.com/jobs',
    sitePattern: 'linkedin.com/jobs',
    tags: ['jobs', 'linkedin', 'career'],
    author: 'HandOff',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: [
      { name: 'job_title', description: 'Job title to search for', required: true },
      { name: 'location', description: 'Location', required: false, defaultValue: 'Remote' },
    ],
    steps: [
      { order: 1, action: { type: 'navigate', url: 'https://www.linkedin.com/jobs', confidence: 0.9 }, description: 'Go to LinkedIn Jobs', waitAfterMs: 2000, isOptional: false },
      { order: 2, action: { type: 'click', x: 400, y: 175, confidence: 0.9 }, description: 'Click job search box', waitAfterMs: 300, isOptional: false },
      { order: 3, action: { type: 'type', x: 400, y: 175, text: '{{job_title}}', confidence: 0.9 }, description: 'Type job title', waitAfterMs: 200, isOptional: false },
      { order: 4, action: { type: 'press', x: 400, y: 175, key: 'Enter', confidence: 0.9 }, description: 'Search', waitAfterMs: 2000, isOptional: false },
    ],
  },
];

// ── Skill Recorder Engine ───────────────────────────────────────────

class SkillRecorderEngine {
  private recordings: Map<string, RecordingSession> = new Map();
  private activeRecording: RecordingSession | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const saved: RecordingSession[] = result[STORAGE_KEY_RECORDINGS] || [];
      saved.forEach(r => this.recordings.set(r.id, r));
      this.initialized = true;
      console.log(`[SkillRecorder] Loaded ${this.recordings.size} recordings`);
    } catch {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    const recordings = Array.from(this.recordings.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_RECORDINGS);
    await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
  }

  // ── Recording Control ─────────────────────────────────────────────

  async startRecording(name: string, description: string, startUrl: string): Promise<RecordingSession> {
    await this.init();

    if (this.activeRecording) {
      await this.stopRecording();
    }

    const session: RecordingSession = {
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      description,
      startUrl,
      startedAt: Date.now(),
      steps: [],
      status: 'recording',
      variables: [],
    };

    this.activeRecording = session;
    this.recordings.set(session.id, session);
    await this.persist();

    console.log(`[SkillRecorder] Started recording: ${name}`);
    return session;
  }

  async recordStep(action: ActionSchema, pageUrl: string, pageTitle: string, selector?: string): Promise<void> {
    if (!this.activeRecording || this.activeRecording.status !== 'recording') return;

    const step: RecordedStep = {
      order: this.activeRecording.steps.length + 1,
      action,
      timestamp: Date.now(),
      pageUrl,
      pageTitle,
      elementSelector: selector,
    };

    this.activeRecording.steps.push(step);
    await this.persist();

    console.log(`[SkillRecorder] Step ${step.order}: ${action.type} on ${pageUrl}`);
  }

  async pauseRecording(): Promise<void> {
    if (this.activeRecording) {
      this.activeRecording.status = 'paused';
      await this.persist();
    }
  }

  async resumeRecording(): Promise<void> {
    if (this.activeRecording && this.activeRecording.status === 'paused') {
      this.activeRecording.status = 'recording';
      await this.persist();
    }
  }

  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.activeRecording) return null;

    this.activeRecording.status = 'completed';
    this.activeRecording.endedAt = Date.now();
    await this.persist();

    const completed = this.activeRecording;
    this.activeRecording = null;

    console.log(`[SkillRecorder] Stopped recording: ${completed.name} (${completed.steps.length} steps)`);
    return completed;
  }

  async cancelRecording(): Promise<void> {
    if (this.activeRecording) {
      this.activeRecording.status = 'cancelled';
      this.activeRecording = null;
      await this.persist();
    }
  }

  isRecording(): boolean {
    return this.activeRecording?.status === 'recording';
  }

  getActiveRecording(): RecordingSession | null {
    return this.activeRecording;
  }

  // ── Convert Recording to Skill ────────────────────────────────────

  async convertToSkill(recordingId: string, variables?: SkillVariable[]): Promise<Skill | null> {
    await this.init();
    const recording = this.recordings.get(recordingId);
    if (!recording || recording.steps.length === 0) return null;

    // Build skill steps from recording
    const steps: SkillStep[] = recording.steps.map((step, i) => {
      let action = { ...step.action };

      // Replace variable values with placeholders
      if (variables && action.text != null) {
        for (const v of variables) {
          if (v.defaultValue && action.text!.includes(v.defaultValue)) {
            action = { ...action, text: action.text!.replace(v.defaultValue, `{{${v.name}}}`) };
          }
        }
      }

      // Calculate wait time from timestamp gaps
      const nextStep = recording.steps[i + 1];
      const waitAfter = nextStep ? Math.min(nextStep.timestamp - step.timestamp, 5000) : 1000;

      return {
        order: step.order,
        action,
        description: step.note || `${step.action.type} on ${step.pageTitle}`,
        waitAfter,
        retryStrategy: 'once' as const,
        isOptional: false,
        successRate: 1,
      };
    });

    // Extract site patterns from recording
    const urls = recording.steps.map(s => s.pageUrl);
    const domains = [...new Set(urls.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean))];

    // Build trigger
    const trigger: SkillTrigger = {
      taskPatterns: [recording.name.toLowerCase()],
      sitePatterns: domains,
      minConfidence: 0.7,
    };

    // Build metadata
    const metadata: SkillMetadata = {
      sourceTraceIds: [recordingId],
      totalExecutions: 0,
      successfulExecutions: 0,
      successRate: 0,
      avgDuration: recording.endedAt ? recording.endedAt - recording.startedAt : 0,
      reliability: 'experimental',
      userApproved: true, // manually created = user approved
    };

    const skill: Skill = {
      id: `sk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: recording.name,
      description: recording.description,
      trigger,
      steps,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    // Save to autoSkill engine
    await autoSkill.init();
    await autoSkill.saveSkill(skill);

    console.log(`[SkillRecorder] Converted recording "${recording.name}" to skill with ${steps.length} steps`);
    return skill;
  }

  // ── Install Template ──────────────────────────────────────────────

  async installTemplate(template: SkillTemplate): Promise<Skill> {
    const steps: SkillStep[] = template.steps.map(s => ({
      order: s.order,
      action: s.action,
      description: s.description,
      waitAfter: s.waitAfterMs,
      retryStrategy: 'once' as const,
      isOptional: s.isOptional,
      successRate: 1,
    }));

    const trigger: SkillTrigger = {
      taskPatterns: template.tags,
      sitePatterns: [template.sitePattern],
      minConfidence: 0.7,
    };

    const metadata: SkillMetadata = {
      sourceTraceIds: [`template:${template.id}`],
      totalExecutions: 0,
      successfulExecutions: 0,
      successRate: 0,
      avgDuration: 0,
      reliability: 'stable',
      userApproved: true,
    };

    const skill: Skill = {
      id: `sk_tpl_${template.id}_${Date.now()}`,
      name: template.name,
      description: template.description,
      trigger,
      steps,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: template.version,
    };

    await autoSkill.init();
    await autoSkill.saveSkill(skill);

    console.log(`[SkillRecorder] Installed template: ${template.name}`);
    return skill;
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  async getRecordings(): Promise<RecordingSession[]> {
    await this.init();
    return Array.from(this.recordings.values())
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async getRecording(id: string): Promise<RecordingSession | null> {
    await this.init();
    return this.recordings.get(id) || null;
  }

  async deleteRecording(id: string): Promise<void> {
    await this.init();
    this.recordings.delete(id);
    await this.persist();
  }

  getTemplates(): SkillTemplate[] {
    return BUILT_IN_TEMPLATES;
  }
}

// Singleton
export const skillRecorder = new SkillRecorderEngine();
