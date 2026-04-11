// Composio REST API Client for HandOff
// Connects to Composio's unified tool platform (250+ apps)
// Uses v3 API: https://backend.composio.dev/api/v3/

const BASE_URL = 'https://backend.composio.dev';
const STORAGE_KEY_API = 'composio_api_key';
const STORAGE_KEY_ENABLED = 'composio_enabled';
const STORAGE_KEY_USER = 'composio_user_id';

// ── Types ────────────────────────────────────────────────────────────

export interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  categories?: string[];
  auth_schemes?: string[];
  status?: string;
  meta?: Record<string, unknown>;
}

export interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  parameters?: {
    properties?: Record<string, { type: string; description?: string; required?: boolean }>;
    required?: string[];
  };
  response?: Record<string, unknown>;
}

export interface ComposioConnectedAccount {
  id: string;
  nanoid?: string;
  toolkit_slug: string;
  toolkit?: { slug: string; name?: string; id?: string };
  status: string;
  created_at?: string;
  updated_at?: string;
  member_id?: string;
  meta?: Record<string, unknown>;
}

export interface ComposioAuthConfig {
  id: string;
  name: string;
  toolkit?: { id: string; slug: string; name: string };
  authScheme?: string;
  type?: string;
  isDisabled?: boolean;
  meta?: Record<string, unknown>;
}

export interface ComposioConnectionRequest {
  toolkit_slug: string;
  user_id?: string;
  redirect_url?: string;
  auth_config_id?: string;
}

export interface ComposioConnectionResponse {
  connection_status?: string;
  connectionStatus?: string;
  connected_account_id?: string;
  connectedAccountId?: string;
  redirect_url?: string;
  redirectUrl?: string;
  id?: string;
  nanoid?: string;
  status?: string;
}

export interface ComposioExecuteRequest {
  tool_slug: string;
  params: Record<string, unknown>;
  connected_account_id?: string;
  user_id?: string;
}

export interface ComposioExecuteResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  execution_id?: string;
}

// ── Client ───────────────────────────────────────────────────────────

export class ComposioClient {
  private apiKey: string = '';
  private enabled: boolean = false;
  private userId: string = 'handoff-default';

  async loadConfig(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_API, STORAGE_KEY_ENABLED, STORAGE_KEY_USER]);
      this.apiKey = result[STORAGE_KEY_API] || '';
      this.enabled = !!result[STORAGE_KEY_ENABLED];
      this.userId = result[STORAGE_KEY_USER] || 'handoff-default';
      console.log(`[Composio] Config loaded: enabled=${this.enabled}, hasKey=${!!this.apiKey}, keyPrefix=${this.apiKey?.slice(0, 6) || 'none'}`);
    } catch (e) {
      console.error('[Composio] Failed to load config:', e);
    }
  }

  async isEnabled(): Promise<boolean> {
    await this.loadConfig();
    return this.enabled && !!this.apiKey;
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ [STORAGE_KEY_API]: key });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: enabled });
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey) await this.loadConfig();
    if (!this.apiKey) throw new Error('Composio API key not configured');

    const url = `${BASE_URL}${path}`;
    console.log(`[Composio] Request: ${options.method || 'GET'} ${url}`);
    
    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          ...((options.headers as Record<string, string>) || {}),
        },
      });
    } catch (fetchErr) {
      console.error(`[Composio] Fetch failed for ${url}:`, fetchErr);
      throw new Error(`Network error calling ${path}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[Composio] HTTP ${res.status} from ${path}: ${text.slice(0, 200)}`);
      throw new Error(`Composio API ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json();
  }

  // ── Health Check ─────────────────────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Always reload config to pick up freshly-saved key
      await this.loadConfig();
      if (!this.apiKey) {
        return { ok: false, error: 'No API key configured' };
      }
      // Try auth/session first (lightest endpoint)
      try {
        console.log('[Composio] Health check: trying /api/v3/auth/session/info...');
        await this.request<unknown>('/api/v3/auth/session/info');
        console.log('[Composio] Health check OK via session/info');
        return { ok: true };
      } catch (sessionErr) {
        console.warn('[Composio] session/info failed, trying /api/v3/toolkits...', sessionErr);
      }
      // Fallback: try toolkits
      await this.request<unknown>('/api/v3/toolkits?limit=1');
      console.log('[Composio] Health check OK via toolkits');
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Composio] Health check failed:', msg);
      return { ok: false, error: msg };
    }
  }

  // ── Toolkits (Apps) ──────────────────────────────────────────────

  async getToolkits(params?: { category?: string; search?: string; limit?: number }): Promise<ComposioToolkit[]> {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    const result = await this.request<{ items?: ComposioToolkit[] }>(`/api/v3/toolkits${qs ? '?' + qs : ''}`);
    return result.items || (result as unknown as ComposioToolkit[]) || [];
  }

  async getToolkit(slug: string): Promise<ComposioToolkit> {
    return this.request<ComposioToolkit>(`/api/v3/toolkits/${slug}`);
  }

  async getCategories(): Promise<string[]> {
    const result = await this.request<{ items?: string[] }>('/api/v3/toolkits/categories');
    return result.items || (result as unknown as string[]) || [];
  }

  // ── Tools (Actions) ──────────────────────────────────────────────

  async getTools(params?: { toolkit?: string; search?: string; limit?: number; tags?: string }): Promise<ComposioTool[]> {
    const query = new URLSearchParams();
    if (params?.toolkit) query.set('toolkit', params.toolkit);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.tags) query.set('tags', params.tags);
    const qs = query.toString();
    const result = await this.request<{ items?: ComposioTool[] }>(`/api/v3/tools${qs ? '?' + qs : ''}`);
    return result.items || (result as unknown as ComposioTool[]) || [];
  }

  async getTool(slug: string): Promise<ComposioTool> {
    return this.request<ComposioTool>(`/api/v3/tools/${slug}`);
  }

  async executeTool(toolSlug: string, params: Record<string, unknown>, connectedAccountId?: string): Promise<ComposioExecuteResponse> {
    const body: Record<string, unknown> = { params };
    if (connectedAccountId) body.connected_account_id = connectedAccountId;
    else body.user_id = this.userId;

    try {
      const result = await this.request<ComposioExecuteResponse>(`/api/v3/tools/execute/${toolSlug}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      result.success = true;
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  // ── Connected Accounts ───────────────────────────────────────────

  async getConnectedAccounts(params?: { toolkit_slug?: string }): Promise<ComposioConnectedAccount[]> {
    const query = new URLSearchParams();
    if (params?.toolkit_slug) query.set('toolkit_slug', params.toolkit_slug);
    const qs = query.toString();
    const result = await this.request<{ items?: ComposioConnectedAccount[] }>(`/api/v3/connected_accounts${qs ? '?' + qs : ''}`);
    return result.items || (result as unknown as ComposioConnectedAccount[]) || [];
  }

  // ── Auth Configs ──────────────────────────────────────────────────

  async getAuthConfigs(toolkit?: string): Promise<ComposioAuthConfig[]> {
    const query = new URLSearchParams();
    if (toolkit) query.set('toolkit', toolkit);
    const qs = query.toString();
    const result = await this.request<{ items?: ComposioAuthConfig[] }>(`/api/v3/auth_configs${qs ? '?' + qs : ''}`);
    return result.items || (result as unknown as ComposioAuthConfig[]) || [];
  }

  async initiateConnection(toolkitSlug: string, redirectUrl?: string): Promise<ComposioConnectionResponse> {
    // v3 API requires auth_config_id — look it up from the toolkit
    console.log(`[Composio] Initiating connection for toolkit: ${toolkitSlug}`);
    
    let authConfigId: string | undefined;
    try {
      const configs = await this.getAuthConfigs(toolkitSlug);
      console.log(`[Composio] Found ${configs.length} auth configs for ${toolkitSlug}`);
      // Pick the first non-disabled config
      const activeConfig = configs.find(c => !c.isDisabled) || configs[0];
      if (activeConfig) {
        authConfigId = activeConfig.id;
        console.log(`[Composio] Using auth config: ${authConfigId} (${activeConfig.authScheme || activeConfig.type || 'unknown'})`);
      }
    } catch (e) {
      console.warn(`[Composio] Could not fetch auth configs for ${toolkitSlug}:`, e);
    }

    const body: Record<string, unknown> = {
      user_id: this.userId,
    };
    // Use auth_config_id if found, otherwise fall back to toolkit_slug
    if (authConfigId) {
      body.auth_config_id = authConfigId;
    } else {
      body.toolkit_slug = toolkitSlug;
    }
    if (redirectUrl) body.redirect_url = redirectUrl;

    console.log(`[Composio] POST /api/v3/connected_accounts body:`, JSON.stringify(body));
    return this.request<ComposioConnectionResponse>('/api/v3/connected_accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async disconnectAccount(nanoid: string): Promise<void> {
    await this.request(`/api/v3/connected_accounts/${nanoid}`, { method: 'DELETE' });
  }

  // ── Utility ──────────────────────────────────────────────────────

  async getToolkitsWithStatus(): Promise<(ComposioToolkit & { connected: boolean; accountId?: string })[]> {
    const [toolkits, accounts] = await Promise.all([
      this.getToolkits({ limit: 100 }),
      this.getConnectedAccounts(),
    ]);

    const accountMap = new Map<string, ComposioConnectedAccount>();
    for (const acc of accounts) {
      if (acc.status === 'active' || acc.status === 'connected') {
        // v3 may nest toolkit slug inside a toolkit object
        const slug = acc.toolkit_slug || acc.toolkit?.slug || '';
        if (slug) accountMap.set(slug, acc);
      }
    }

    return toolkits.map(tk => ({
      ...tk,
      connected: accountMap.has(tk.slug),
      accountId: accountMap.get(tk.slug)?.nanoid || accountMap.get(tk.slug)?.id,
    }));
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _client: ComposioClient | null = null;
export function getComposioClient(): ComposioClient {
  if (!_client) _client = new ComposioClient();
  return _client;
}
