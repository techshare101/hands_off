// ComposioClient Integration Tests
// Validates API calls, error handling, health check fallback, and initiateConnection flow

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome.storage ─────────────────────────────────────────────

const storageData: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          if (k in storageData) result[k] = storageData[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageData, items);
      }),
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: { sendMessage: vi.fn(async () => ({ success: true })) },
});

// ── Mock fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Import after mocks ──────────────────────────────────────────────

const { ComposioClient } = await import('../composioClient');

// ── Helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function errorResponse(status: number, body = '') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ComposioClient', () => {
  let client: InstanceType<typeof ComposioClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    for (const k of Object.keys(storageData)) delete storageData[k];

    // Default: configured and enabled
    storageData.composio_api_key = 'ak_test123';
    storageData.composio_enabled = true;

    client = new ComposioClient();
  });

  // ── isEnabled ───────────────────────────────────────────────────

  it('isEnabled returns true when key and enabled flag are set', async () => {
    expect(await client.isEnabled()).toBe(true);
  });

  it('isEnabled returns false when no API key', async () => {
    storageData.composio_api_key = '';
    expect(await client.isEnabled()).toBe(false);
  });

  it('isEnabled returns false when disabled', async () => {
    storageData.composio_enabled = false;
    expect(await client.isEnabled()).toBe(false);
  });

  // ── healthCheck ─────────────────────────────────────────────────

  it('healthCheck succeeds via session/info endpoint', async () => {
    mockFetch.mockImplementationOnce(() => jsonResponse({ user: 'test' }));

    const result = await client.healthCheck();

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/v3/auth/session/info');
  });

  it('healthCheck falls back to toolkits when session/info fails', async () => {
    mockFetch
      .mockImplementationOnce(() => errorResponse(500, 'Internal error'))
      .mockImplementationOnce(() => jsonResponse({ items: [] }));

    const result = await client.healthCheck();

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('/api/v3/toolkits');
  });

  it('healthCheck returns error when no API key', async () => {
    storageData.composio_api_key = '';

    const result = await client.healthCheck();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No API key');
  });

  it('healthCheck returns error on 401', async () => {
    mockFetch
      .mockImplementationOnce(() => errorResponse(401, 'Unauthorized'))
      .mockImplementationOnce(() => errorResponse(401, 'Unauthorized'));

    const result = await client.healthCheck();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  // ── getToolkits ─────────────────────────────────────────────────

  it('getToolkits returns items array', async () => {
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ items: [{ slug: 'github', name: 'GitHub', description: 'Dev' }] })
    );

    const toolkits = await client.getToolkits({ limit: 10 });

    expect(toolkits).toHaveLength(1);
    expect(toolkits[0].slug).toBe('github');
    expect(mockFetch.mock.calls[0][0]).toContain('limit=10');
  });

  it('getToolkits handles flat array response', async () => {
    mockFetch.mockImplementationOnce(() =>
      jsonResponse([{ slug: 'slack', name: 'Slack', description: 'Chat' }])
    );

    const toolkits = await client.getToolkits();
    expect(toolkits).toHaveLength(1);
    expect(toolkits[0].slug).toBe('slack');
  });

  // ── getTools ────────────────────────────────────────────────────

  it('getTools passes query params correctly', async () => {
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ items: [{ slug: 'GITHUB_CREATE_ISSUE', name: 'Create Issue', description: 'x', toolkit: 'github' }] })
    );

    const tools = await client.getTools({ toolkit: 'github', limit: 5 });

    expect(tools).toHaveLength(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('toolkit=github');
    expect(url).toContain('limit=5');
  });

  // ── executeTool ─────────────────────────────────────────────────

  it('executeTool sends correct body with connected_account_id', async () => {
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ data: { result: 'ok' } })
    );

    const result = await client.executeTool('GITHUB_STAR', { repo: 'test' }, 'ca_123');

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.connected_account_id).toBe('ca_123');
    expect(body.params.repo).toBe('test');
  });

  it('executeTool uses user_id when no connected_account_id', async () => {
    mockFetch.mockImplementationOnce(() => jsonResponse({ data: {} }));

    await client.executeTool('SOME_TOOL', {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_id).toBe('handoff-default');
    expect(body.connected_account_id).toBeUndefined();
  });

  it('executeTool returns error on network failure', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network down')));

    const result = await client.executeTool('TOOL', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network');
  });

  // ── initiateConnection ──────────────────────────────────────────

  it('initiateConnection fetches auth_config_id then POSTs', async () => {
    // 1st call: getAuthConfigs
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ items: [{ id: 'ac_github_oauth', authScheme: 'OAUTH2', isDisabled: false }] })
    );
    // 2nd call: POST connected_accounts
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ redirect_url: 'https://github.com/oauth', connection_status: 'initiated' })
    );

    const result = await client.initiateConnection('github');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Verify auth_config_id was used
    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody.auth_config_id).toBe('ac_github_oauth');
    expect(postBody.toolkit_slug).toBeUndefined();
    expect(result.redirect_url).toBe('https://github.com/oauth');
  });

  it('initiateConnection falls back to toolkit_slug when no auth configs', async () => {
    // getAuthConfigs returns empty
    mockFetch.mockImplementationOnce(() => jsonResponse({ items: [] }));
    // POST connected_accounts
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({ connection_status: 'active' })
    );

    await client.initiateConnection('notion');

    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody.toolkit_slug).toBe('notion');
    expect(postBody.auth_config_id).toBeUndefined();
  });

  it('initiateConnection skips disabled auth configs', async () => {
    mockFetch.mockImplementationOnce(() =>
      jsonResponse({
        items: [
          { id: 'ac_disabled', authScheme: 'OAUTH2', isDisabled: true },
          { id: 'ac_active', authScheme: 'API_KEY', isDisabled: false },
        ],
      })
    );
    mockFetch.mockImplementationOnce(() => jsonResponse({ connection_status: 'active' }));

    await client.initiateConnection('slack');

    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody.auth_config_id).toBe('ac_active');
  });

  // ── Network errors ──────────────────────────────────────────────

  it('request throws on fetch failure', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(client.getToolkits()).rejects.toThrow('Network error');
  });

  it('request throws on HTTP error with body', async () => {
    mockFetch.mockImplementationOnce(() => errorResponse(403, 'Forbidden'));

    await expect(client.getToolkits()).rejects.toThrow('Composio API 403');
  });
});
