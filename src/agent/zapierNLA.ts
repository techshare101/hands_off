// Zapier Natural Language Actions (NLA) API Client
// Lightweight, MV3-compliant REST client for listing & executing Zapier actions.
// Docs: https://nla.zapier.com/docs

const NLA_BASE = 'https://nla.zapier.com/api/v1';
const STORAGE_KEY_API_KEY = 'zapier_nla_api_key';

export interface ZapierAction {
  id: string;
  description: string;
  params: Record<string, string>; // parameter name → description
}

export interface ZapierExecutionResult {
  id: string;
  action_used: string;
  result: Record<string, unknown>;
  status: 'success' | 'error';
  error?: string;
}

class ZapierNLAClient {
  private apiKey = '';
  private initialized = false;

  async loadKey(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_API_KEY);
      this.apiKey = result[STORAGE_KEY_API_KEY] || '';
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ [STORAGE_KEY_API_KEY]: key });
  }

  async getApiKey(): Promise<string> {
    await this.loadKey();
    return this.apiKey;
  }

  /**
   * Validate the API key by listing actions (limit 1).
   * Returns true if the key is accepted by Zapier NLA.
   */
  async validate(key?: string): Promise<boolean> {
    const apiKey = key || (await this.getApiKey());
    if (!apiKey) return false;

    try {
      const res = await fetch(`${NLA_BASE}/exposed/`, {
        headers: this.headers(apiKey),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all actions the user has exposed in their Zapier NLA dashboard.
   * Each action corresponds to a Zap configured for AI use.
   */
  async listActions(key?: string): Promise<ZapierAction[]> {
    const apiKey = key || (await this.getApiKey());
    if (!apiKey) return [];

    const res = await fetch(`${NLA_BASE}/exposed/`, {
      headers: this.headers(apiKey),
    });

    if (!res.ok) {
      console.error('[ZapierNLA] List actions failed:', res.status);
      return [];
    }

    const data = await res.json();
    const results: { id: string; description: string; params: Record<string, string> }[] =
      data.results || [];

    return results.map(action => ({
      id: action.id,
      description: action.description,
      params: action.params || {},
    }));
  }

  /**
   * Execute a specific NLA action by ID with the given parameters.
   * Zapier NLA also supports `instructions` — a plain-English description
   * of what to do — which lets the LLM drive the action naturally.
   */
  async executeAction(
    actionId: string,
    params: Record<string, unknown>,
    instructions?: string,
    key?: string,
  ): Promise<ZapierExecutionResult> {
    const apiKey = key || (await this.getApiKey());
    if (!apiKey) {
      return { id: actionId, action_used: actionId, result: {}, status: 'error', error: 'No API key' };
    }

    const body: Record<string, unknown> = { ...params };
    if (instructions) body.instructions = instructions;

    const res = await fetch(`${NLA_BASE}/exposed/${actionId}/execute/`, {
      method: 'POST',
      headers: {
        ...this.headers(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        id: actionId,
        action_used: actionId,
        result: {},
        status: 'error',
        error: `Zapier NLA ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    return {
      id: data.id || actionId,
      action_used: data.action_used || actionId,
      result: data.result || data,
      status: 'success',
    };
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      'x-api-key': apiKey,
      Accept: 'application/json',
    };
  }
}

// Singleton
export const zapierNLA = new ZapierNLAClient();
