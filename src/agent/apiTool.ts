// 🌐 API TOOL — Make HTTP requests to any REST API
// Gives the agent "hands" beyond the browser: call Stripe, webhooks, databases, etc.
// Runs in the background worker (service worker), not content scripts
// Security: user must whitelist domains, requests are logged

const STORAGE_KEY_API_CONFIG = 'handoff_api_tool_config';
const STORAGE_KEY_API_LOG = 'handoff_api_log';
const MAX_LOG_ENTRIES = 200;
const DEFAULT_TIMEOUT = 15000; // 15s

// ── Types ───────────────────────────────────────────────────────────

export interface ApiToolConfig {
  enabled: boolean;
  allowedDomains: string[]; // e.g. ['api.stripe.com', 'hooks.slack.com']
  savedHeaders: Record<string, string>; // default headers for all requests
  savedEndpoints: SavedEndpoint[];
}

export interface SavedEndpoint {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  bodyTemplate?: string; // JSON template with {{variables}}
  description: string;
}

export interface ApiRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface ApiResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyText?: string;
  error?: string;
  latencyMs: number;
}

export interface ApiLogEntry {
  id: string;
  timestamp: number;
  request: { method: HttpMethod; url: string; hasBody: boolean };
  response: { status: number; success: boolean; latencyMs: number };
  triggeredBy: 'agent' | 'user' | 'skill';
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// ── API Tool Engine ─────────────────────────────────────────────────

class ApiToolEngine {
  private config: ApiToolConfig = {
    enabled: false,
    allowedDomains: [],
    savedHeaders: {},
    savedEndpoints: [],
  };
  private log: ApiLogEntry[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_API_CONFIG, STORAGE_KEY_API_LOG]);
      if (result[STORAGE_KEY_API_CONFIG]) {
        this.config = { ...this.config, ...result[STORAGE_KEY_API_CONFIG] };
      }
      this.log = result[STORAGE_KEY_API_LOG] || [];
      this.initialized = true;
      console.log(`[ApiTool] Initialized: enabled=${this.config.enabled}, domains=${this.config.allowedDomains.length}`);
    } catch {
      this.initialized = true;
    }
  }

  async isEnabled(): Promise<boolean> {
    await this.init();
    return this.config.enabled;
  }

  // ── Core Request Method ───────────────────────────────────────────

  async execute(request: ApiRequest, triggeredBy: 'agent' | 'user' | 'skill' = 'agent'): Promise<ApiResponse> {
    await this.init();

    if (!this.config.enabled) {
      return { success: false, error: 'API Tool is disabled. Enable it in Settings.', latencyMs: 0 };
    }

    // Domain check
    const domain = this.extractDomain(request.url);
    if (!domain) {
      return { success: false, error: `Invalid URL: ${request.url}`, latencyMs: 0 };
    }

    if (!this.isDomainAllowed(domain)) {
      return {
        success: false,
        error: `Domain "${domain}" is not whitelisted. Add it in Settings → API Tool → Allowed Domains.`,
        latencyMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = request.timeout || DEFAULT_TIMEOUT;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Merge headers: saved defaults + request-specific
      const headers: Record<string, string> = {
        ...this.config.savedHeaders,
        ...request.headers,
      };

      // Auto-set Content-Type for JSON bodies
      if (request.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
        signal: controller.signal,
      };

      if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
        fetchOptions.body = typeof request.body === 'string' 
          ? request.body 
          : JSON.stringify(request.body);
      }

      const response = await fetch(request.url, fetchOptions);
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      // Parse response
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let body: unknown;
      let bodyText: string;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        bodyText = await response.text();
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      } else {
        bodyText = await response.text();
        body = bodyText;
      }

      // Log the request
      await this.logRequest({
        method: request.method,
        url: request.url,
        hasBody: !!request.body,
      }, {
        status: response.status,
        success: response.ok,
        latencyMs,
      }, triggeredBy);

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        bodyText: bodyText.slice(0, 5000), // cap at 5KB for storage
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timed out', latencyMs };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Request failed',
        latencyMs,
      };
    }
  }

  // ── Saved Endpoints ───────────────────────────────────────────────

  async executeEndpoint(endpointId: string, variables?: Record<string, string>): Promise<ApiResponse> {
    await this.init();
    const endpoint = this.config.savedEndpoints.find(e => e.id === endpointId);
    if (!endpoint) {
      return { success: false, error: `Endpoint not found: ${endpointId}`, latencyMs: 0 };
    }

    let body: unknown;
    if (endpoint.bodyTemplate && variables) {
      let bodyStr = endpoint.bodyTemplate;
      for (const [key, value] of Object.entries(variables)) {
        bodyStr = bodyStr.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      try {
        body = JSON.parse(bodyStr);
      } catch {
        body = bodyStr;
      }
    }

    return this.execute({
      method: endpoint.method,
      url: endpoint.url,
      headers: endpoint.headers,
      body,
    }, 'skill');
  }

  // ── Configuration ─────────────────────────────────────────────────

  async getConfig(): Promise<ApiToolConfig> {
    await this.init();
    return { ...this.config };
  }

  async setConfig(update: Partial<ApiToolConfig>): Promise<void> {
    await this.init();
    this.config = { ...this.config, ...update };
    await chrome.storage.local.set({ [STORAGE_KEY_API_CONFIG]: this.config });
  }

  async addDomain(domain: string): Promise<void> {
    await this.init();
    const normalized = domain.toLowerCase().trim();
    if (!this.config.allowedDomains.includes(normalized)) {
      this.config.allowedDomains.push(normalized);
      await chrome.storage.local.set({ [STORAGE_KEY_API_CONFIG]: this.config });
    }
  }

  async removeDomain(domain: string): Promise<void> {
    await this.init();
    this.config.allowedDomains = this.config.allowedDomains.filter(d => d !== domain.toLowerCase().trim());
    await chrome.storage.local.set({ [STORAGE_KEY_API_CONFIG]: this.config });
  }

  async addEndpoint(endpoint: Omit<SavedEndpoint, 'id'>): Promise<SavedEndpoint> {
    await this.init();
    const saved: SavedEndpoint = {
      ...endpoint,
      id: `ep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    this.config.savedEndpoints.push(saved);
    await chrome.storage.local.set({ [STORAGE_KEY_API_CONFIG]: this.config });
    return saved;
  }

  async removeEndpoint(id: string): Promise<void> {
    await this.init();
    this.config.savedEndpoints = this.config.savedEndpoints.filter(e => e.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY_API_CONFIG]: this.config });
  }

  // ── Logging ───────────────────────────────────────────────────────

  private async logRequest(
    request: { method: HttpMethod; url: string; hasBody: boolean },
    response: { status: number; success: boolean; latencyMs: number },
    triggeredBy: 'agent' | 'user' | 'skill'
  ): Promise<void> {
    const entry: ApiLogEntry = {
      id: `log_${Date.now()}`,
      timestamp: Date.now(),
      request,
      response,
      triggeredBy,
    };

    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(-MAX_LOG_ENTRIES);
    }

    await chrome.storage.local.set({ [STORAGE_KEY_API_LOG]: this.log });
  }

  async getLog(limit = 50): Promise<ApiLogEntry[]> {
    await this.init();
    return this.log.slice(-limit);
  }

  async clearLog(): Promise<void> {
    this.log = [];
    await chrome.storage.local.remove(STORAGE_KEY_API_LOG);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  private isDomainAllowed(domain: string): boolean {
    return this.config.allowedDomains.some(allowed => {
      if (allowed.startsWith('*.')) {
        return domain.endsWith(allowed.slice(1)) || domain === allowed.slice(2);
      }
      return domain === allowed;
    });
  }

  // Format API response for LLM prompt injection
  formatForPrompt(response: ApiResponse): string {
    if (!response.success) {
      return `\n[API CALL FAILED]: ${response.error}\n`;
    }

    let result = `\n[API RESPONSE — ${response.status} ${response.statusText}]\n`;
    if (typeof response.body === 'object') {
      result += JSON.stringify(response.body, null, 2).slice(0, 2000);
    } else {
      result += String(response.bodyText || '').slice(0, 2000);
    }
    result += `\n[Latency: ${response.latencyMs}ms]\n`;
    return result;
  }

  getStats(): { totalRequests: number; successRate: number; avgLatency: number } {
    const total = this.log.length;
    if (total === 0) return { totalRequests: 0, successRate: 0, avgLatency: 0 };

    const successful = this.log.filter(e => e.response.success).length;
    const avgLatency = this.log.reduce((sum, e) => sum + e.response.latencyMs, 0) / total;

    return {
      totalRequests: total,
      successRate: successful / total,
      avgLatency: Math.round(avgLatency),
    };
  }
}

// Singleton
export const apiTool = new ApiToolEngine();
