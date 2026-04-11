// ConnectionManager Integration Tests
// Validates connect/disconnect, persistence, validation logic, and getConnectedApps

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome APIs ────────────────────────────────────────────────

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
  runtime: {
    sendMessage: vi.fn(async () => ({ success: true })),
  },
});

// ── Import after mocks ──────────────────────────────────────────────

const { ConnectionManager, APP_REGISTRY } = await import('../connectHub');

// ── Tests ───────────────────────────────────────────────────────────

describe('ConnectionManager', () => {
  let mgr: InstanceType<typeof ConnectionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(storageData)) delete storageData[k];
    mgr = new ConnectionManager();
  });

  // ── init / persistence ──────────────────────────────────────────

  it('initializes from empty storage', async () => {
    const conns = await mgr.getAllConnections();
    expect(conns).toEqual([]);
  });

  it('initializes from saved connections in storage', async () => {
    storageData.handoff_connections = [
      { appId: 'google-search', method: 'api', status: 'connected', config: { apiKey: 'test' } },
    ];

    const freshMgr = new ConnectionManager();
    const conns = await freshMgr.getAllConnections();

    expect(conns).toHaveLength(1);
    expect(conns[0].appId).toBe('google-search');
  });

  it('persists connections to chrome.storage.local', async () => {
    await mgr.connect('google-search', 'api', { apiKey: 'AIza_test_key_123' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff_connections: expect.arrayContaining([
          expect.objectContaining({ appId: 'google-search' }),
        ]),
      })
    );
  });

  // ── connect ─────────────────────────────────────────────────────

  it('connects an API app with valid key', async () => {
    const conn = await mgr.connect('google-search', 'api', { apiKey: 'AIza_valid_key_1234' });

    expect(conn.status).toBe('connected');
    expect(conn.appId).toBe('google-search');
    expect(conn.method).toBe('api');
    expect(conn.connectedAt).toBeDefined();
  });

  it('fails API connection with short key', async () => {
    const conn = await mgr.connect('google-search', 'api', { apiKey: 'abc' });

    expect(conn.status).toBe('error');
    expect(conn.error).toContain('Validation failed');
  });

  it('throws for unknown app ID', async () => {
    await expect(mgr.connect('nonexistent', 'api', {})).rejects.toThrow('Unknown app');
  });

  it('throws for unsupported connection method', async () => {
    // google-search only supports 'api'
    await expect(mgr.connect('google-search', 'mcp' as any, {})).rejects.toThrow("doesn't support");
  });

  it('connects MCP app via runtime message', async () => {
    // Find an app that supports MCP
    const mcpApp = APP_REGISTRY.find((a: any) => a.methods.includes('mcp'));
    if (!mcpApp) return; // skip if no MCP apps in registry

    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true });

    const conn = await mgr.connect(mcpApp.id, 'mcp', { endpoint: 'http://localhost:3001' });
    expect(conn.status).toBe('connected');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MCP_CLIENT_ADD_SERVER' })
    );
  });

  it('handles MCP validation failure', async () => {
    const mcpApp = APP_REGISTRY.find((a: any) => a.methods.includes('mcp'));
    if (!mcpApp) return;

    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });

    const conn = await mgr.connect(mcpApp.id, 'mcp', { endpoint: 'http://bad-server' });
    expect(conn.status).toBe('error');
  });

  // ── disconnect ──────────────────────────────────────────────────

  it('disconnects and removes from storage', async () => {
    await mgr.connect('google-search', 'api', { apiKey: 'AIza_valid_key_1234' });
    expect((await mgr.getAllConnections()).length).toBe(1);

    await mgr.disconnect('google-search');

    expect((await mgr.getAllConnections()).length).toBe(0);
    expect(await mgr.getConnection('google-search')).toBeNull();
  });

  // ── getConnection ───────────────────────────────────────────────

  it('getConnection returns null for unknown app', async () => {
    expect(await mgr.getConnection('nope')).toBeNull();
  });

  it('getConnection returns stored connection', async () => {
    await mgr.connect('google-search', 'api', { apiKey: 'AIza_valid_key_1234' });

    const conn = await mgr.getConnection('google-search');
    expect(conn).not.toBeNull();
    expect(conn!.appId).toBe('google-search');
  });

  // ── getConnectedApps ────────────────────────────────────────────

  it('getConnectedApps only returns apps with connected status', async () => {
    await mgr.connect('google-search', 'api', { apiKey: 'AIza_valid_key_1234' }); // connected
    await mgr.connect('google-search', 'api', { apiKey: 'bad' }); // error (overwrites)

    const apps = await mgr.getConnectedApps();
    // short key → error → no connected apps
    expect(apps).toHaveLength(0);
  });

  it('getConnectedApps returns AppDefinition objects', async () => {
    await mgr.connect('google-search', 'api', { apiKey: 'AIza_valid_key_1234' });

    const apps = await mgr.getConnectedApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toHaveProperty('id', 'google-search');
    expect(apps[0]).toHaveProperty('name');
    expect(apps[0]).toHaveProperty('methods');
    expect(apps[0]).toHaveProperty('defaults');
  });

  // ── multiple connections ────────────────────────────────────────

  it('handles multiple simultaneous connections', async () => {
    // Connect all API-capable apps
    const apiApps = APP_REGISTRY.filter((a: any) => a.methods.includes('api')).slice(0, 3);

    for (const app of apiApps) {
      await mgr.connect(app.id, 'api', { apiKey: 'test_key_long_enough' });
    }

    const allConns = await mgr.getAllConnections();
    expect(allConns.length).toBe(apiApps.length);

    const connectedApps = await mgr.getConnectedApps();
    expect(connectedApps.length).toBe(apiApps.length);
  });
});
