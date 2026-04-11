// CapabilitySyncAdapter Integration Test
// Validates hot-swap routing: Connect Hub → mcpClient virtual tools → DecisionRouter visibility

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome.storage before any imports ──────────────────────────

const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, namespace: string) => void> = [];
const storageData: Record<string, unknown> = {};

const mockChrome = {
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
    onChanged: {
      addListener: vi.fn((fn: typeof storageListeners[0]) => {
        storageListeners.push(fn);
      }),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(async () => ({ success: true })),
  },
  tabs: {
    create: vi.fn(),
  },
};

vi.stubGlobal('chrome', mockChrome);

// ── Mock modules ────────────────────────────────────────────────────

// Track calls to mcpClient
const registeredTools: Array<{ serverId: string; serverName: string; name: string; description: string; inputSchema: Record<string, unknown> }> = [];
const removedServerIds: string[] = [];

vi.mock('../mcpClient', () => ({
  mcpClient: {
    registerVirtualTool: vi.fn((tool: typeof registeredTools[0]) => {
      registeredTools.push(tool);
    }),
    removeServerTools: vi.fn((serverId: string) => {
      removedServerIds.push(serverId);
    }),
    getAllCachedTools: vi.fn(() => [...registeredTools]),
  },
}));

vi.mock('../connectHub', () => {
  const mockApps: Array<{
    id: string; name: string; icon: string; category: string; description: string;
    methods: string[]; defaults: Record<string, { tools?: string[]; endpoint?: string }>;
  }> = [];
  const mockConns: Map<string, { appId: string; method: string; status: string; config: Record<string, string> }> = new Map();

  return {
    getConnectionManager: vi.fn(() => ({
      getConnectedApps: vi.fn(async () => mockApps.filter(a => {
        const c = mockConns.get(a.id);
        return c?.status === 'connected';
      })),
      getConnection: vi.fn(async (id: string) => mockConns.get(id) || null),
    })),
    // Test helpers (not part of real API — used to set up state)
    __setMockApps: (apps: typeof mockApps) => { mockApps.length = 0; mockApps.push(...apps); },
    __setMockConn: (id: string, conn: { appId: string; method: string; status: string; config: Record<string, string> }) => {
      mockConns.set(id, conn);
    },
    __clearMockConns: () => mockConns.clear(),
  };
});

vi.mock('../composioClient', () => ({
  getComposioClient: vi.fn(() => ({
    isEnabled: vi.fn(async () => !!storageData.composio_enabled && !!storageData.composio_api_key),
    getConnectedAccounts: vi.fn(async () => (storageData.__composio_accounts as unknown[]) || []),
    getTools: vi.fn(async () => (storageData.__composio_tools as unknown[]) || []),
  })),
}));

// ── Import adapter AFTER mocks ──────────────────────────────────────

// We can't use the singleton because it's created at import time.
// Instead, re-create the engine for each test.
// But the module exports a singleton... so we'll reset it.
const { capabilitySyncAdapter } = await import('../capabilitySyncAdapter');
const { __setMockApps, __setMockConn, __clearMockConns } = await import('../connectHub') as any;
const { mcpClient } = await import('../mcpClient');

// ── Tests ───────────────────────────────────────────────────────────

describe('CapabilitySyncAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
    removedServerIds.length = 0;
    storageListeners.length = 0;
    __clearMockConns();
    // Reset internal state by clearing storage data
    for (const key of Object.keys(storageData)) delete storageData[key];
  });

  it('registers virtual MCP tools for locally connected API apps', async () => {
    // Set up: Google Search connected via API with 2 tools
    __setMockApps([{
      id: 'google-search',
      name: 'Google Search',
      icon: '🔍',
      category: 'search',
      description: 'Web search',
      methods: ['api'],
      defaults: { api: { tools: ['web_search', 'image_search'] } },
    }]);
    __setMockConn('google-search', {
      appId: 'google-search',
      method: 'api',
      status: 'connected',
      config: { apiKey: 'test-key' },
    });

    await capabilitySyncAdapter.sync();

    expect(mcpClient.registerVirtualTool).toHaveBeenCalledTimes(2);
    expect(registeredTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: 'connecthub_google-search', name: 'web_search' }),
        expect.objectContaining({ serverId: 'connecthub_google-search', name: 'image_search' }),
      ])
    );
  });

  it('skips MCP-method apps (already registered natively)', async () => {
    __setMockApps([{
      id: 'slack-mcp',
      name: 'Slack',
      icon: '💬',
      category: 'communication',
      description: 'Slack via MCP',
      methods: ['mcp'],
      defaults: { mcp: { endpoint: 'http://localhost:3001/mcp', tools: ['send_message'] } },
    }]);
    __setMockConn('slack-mcp', {
      appId: 'slack-mcp',
      method: 'mcp',
      status: 'connected',
      config: { endpoint: 'http://localhost:3001/mcp' },
    });

    await capabilitySyncAdapter.sync();

    // MCP connections are handled natively, adapter should NOT re-register
    expect(mcpClient.registerVirtualTool).not.toHaveBeenCalled();
  });

  it('registers Composio tools for active connected accounts', async () => {
    storageData.composio_enabled = true;
    storageData.composio_api_key = 'ak_test123';
    (storageData as any).__composio_accounts = [
      { id: 'ca_1', toolkit_slug: 'github', status: 'active' },
    ];
    (storageData as any).__composio_tools = [
      { slug: 'GITHUB_CREATE_ISSUE', name: 'Create Issue', description: 'Create a GitHub issue', toolkit: 'github', parameters: {} },
      { slug: 'GITHUB_STAR_REPO', name: 'Star Repo', description: 'Star a repository', toolkit: 'github', parameters: {} },
      { slug: 'SLACK_SEND_MSG', name: 'Send Message', description: 'Send Slack message', toolkit: 'slack', parameters: {} },
    ];

    // Clear the adapter's internal cache so it sees new data
    __setMockApps([]);

    await capabilitySyncAdapter.sync();

    // Should only register the 2 github tools (connected), not the slack tool
    const composioRegistrations = registeredTools.filter(t => t.serverId === '__composio__');
    expect(composioRegistrations).toHaveLength(2);
    expect(composioRegistrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'composio_GITHUB_CREATE_ISSUE', serverName: 'Composio' }),
        expect.objectContaining({ name: 'composio_GITHUB_STAR_REPO', serverName: 'Composio' }),
      ])
    );
  });

  it('clears Composio tools when disabled', async () => {
    __setMockApps([]);

    // First enable and sync to populate internal cache
    storageData.composio_enabled = true;
    storageData.composio_api_key = 'ak_test123';
    (storageData as any).__composio_accounts = [
      { id: 'ca_1', toolkit_slug: 'notion', status: 'active' },
    ];
    (storageData as any).__composio_tools = [
      { slug: 'NOTION_CREATE_PAGE', name: 'Create Page', description: 'Test', toolkit: 'notion', parameters: {} },
    ];

    await capabilitySyncAdapter.sync();
    // Verify at least 1 composio tool was registered
    expect(registeredTools.some(t => t.serverId === '__composio__')).toBe(true);

    // Now disable Composio and re-sync
    storageData.composio_enabled = false;
    storageData.composio_api_key = '';

    await capabilitySyncAdapter.sync();

    expect(mcpClient.removeServerTools).toHaveBeenCalledWith('__composio__');
    expect(removedServerIds).toContain('__composio__');
  });

  it('tools are visible to DecisionRouter via getAllCachedTools()', async () => {
    __setMockApps([{
      id: 'github',
      name: 'GitHub',
      icon: '🐙',
      category: 'development',
      description: 'GitHub integration',
      methods: ['api'],
      defaults: { api: { tools: ['create_issue', 'list_repos'] } },
    }]);
    __setMockConn('github', {
      appId: 'github',
      method: 'api',
      status: 'connected',
      config: { apiKey: 'ghp_test' },
    });

    await capabilitySyncAdapter.sync();

    // DecisionRouter calls mcpClient.getAllCachedTools() — verify it returns our tools
    const allTools = mcpClient.getAllCachedTools();
    expect(allTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'create_issue' }),
        expect.objectContaining({ name: 'list_repos' }),
      ])
    );
  });

  it('getStatus() reports synced state', async () => {
    __setMockApps([{
      id: 'test-app',
      name: 'Test',
      icon: '🧪',
      category: 'data',
      description: 'Test app',
      methods: ['api'],
      defaults: { api: { tools: ['test_tool'] } },
    }]);
    __setMockConn('test-app', {
      appId: 'test-app',
      method: 'api',
      status: 'connected',
      config: { apiKey: 'x' },
    });

    await capabilitySyncAdapter.sync();

    const status = capabilitySyncAdapter.getStatus();
    expect(status.local).toContain('test-app');
    expect(status.syncing).toBe(false);
  });
});
