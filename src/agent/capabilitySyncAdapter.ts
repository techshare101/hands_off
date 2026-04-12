// CapabilitySyncAdapter — Bridges Connect Hub connections into the DecisionRouter
// Watches chrome.storage for connection changes and injects Composio tools
// into MCP-compatible format so the existing routing pipeline picks them up.

import { mcpClient } from './mcpClient';
import { getConnectionManager, type AppDefinition } from './connectHub';
import { getComposioClient } from './composioClient';
import { zapierNLA } from './zapierNLA';

const COMPOSIO_MCP_SERVER_ID = '__composio__';

interface SyncState {
  localApps: string[];    // app IDs from Connect Hub
  composioTools: string[]; // tool slugs from Composio
}

class CapabilitySyncAdapterEngine {
  private lastSync: SyncState = { localApps: [], composioTools: [] };
  private isSyncing = false;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Initial sync
    await this.sync();

    // Watch for storage changes (Connect Hub saves connections here)
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (changes.handoff_connections || changes.composio_enabled || changes.composio_api_key) {
        console.log('[CapabilitySyncAdapter] Storage changed, re-syncing...');
        this.sync();
      }
    });
  }

  async sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      await Promise.all([
        this.syncLocalConnections(),
        this.syncComposioTools(),
      ]);
    } catch (e) {
      console.error('[CapabilitySyncAdapter] Sync error:', e);
    } finally {
      this.isSyncing = false;
    }
  }

  // Sync local Connect Hub connections into MCP client as virtual servers
  private async syncLocalConnections(): Promise<void> {
    try {
      const mgr = getConnectionManager();
      const connectedApps: AppDefinition[] = await mgr.getConnectedApps();
      const appIds = connectedApps.map(a => a.id);

      // Only re-sync if the set changed
      if (JSON.stringify(appIds) === JSON.stringify(this.lastSync.localApps)) return;
      this.lastSync.localApps = appIds;

      console.log(`[CapabilitySyncAdapter] Local apps connected: ${appIds.join(', ') || 'none'}`);

      // For each connected app, register its tools with the MCP client
      // so the DecisionRouter's MCP pattern matching picks them up
      for (const app of connectedApps) {
        const conn = await mgr.getConnection(app.id);
        if (!conn || conn.status !== 'connected') continue;

        const defaults = app.defaults[conn.method];
        const toolNames = defaults?.tools || [];

        if (conn.method === 'mcp' && defaults?.endpoint) {
          // Already registered via MCP_CLIENT_ADD_SERVER during connect
          continue;
        }

        // Zapier: dynamically discover exposed NLA actions
        if (app.id === 'zapier') {
          await this.syncZapierActions(conn.config.apiKey || conn.config.token || '');
          continue;
        }

        // For API and A2A connections, register tools as virtual MCP tools
        // so the router's pattern matching can find them
        for (const toolName of toolNames) {
          mcpClient.registerVirtualTool({
            serverId: `connecthub_${app.id}`,
            serverName: app.name,
            name: toolName,
            description: `${app.name}: ${app.description}`,
            inputSchema: {},
          });
        }
      }
    } catch (e) {
      console.error('[CapabilitySyncAdapter] Local sync failed:', e);
    }
  }

  // Sync Composio tools for connected accounts
  private async syncComposioTools(): Promise<void> {
    try {
      const composio = getComposioClient();
      const enabled = await composio.isEnabled();
      if (!enabled) {
        if (this.lastSync.composioTools.length > 0) {
          // Composio was disabled — clear its tools
          mcpClient.removeServerTools(COMPOSIO_MCP_SERVER_ID);
          this.lastSync.composioTools = [];
          console.log('[CapabilitySyncAdapter] Composio disabled, tools cleared');
        }
        return;
      }

      // Get connected accounts from Composio
      const accounts = await composio.getConnectedAccounts();
      const activeAccounts = accounts.filter(a => a.status === 'active' || a.status === 'connected');
      const toolkitSlugs = activeAccounts.map(a => a.toolkit_slug || a.toolkit?.slug || '').filter(Boolean);

      if (JSON.stringify(toolkitSlugs) === JSON.stringify(this.lastSync.composioTools)) return;
      this.lastSync.composioTools = toolkitSlugs;

      if (toolkitSlugs.length === 0) {
        console.log('[CapabilitySyncAdapter] No active Composio accounts');
        return;
      }

      // Fetch tools for connected toolkits
      const allTools = await composio.getTools({ limit: 50 });
      const connectedTools = allTools.filter(t => toolkitSlugs.includes(t.toolkit));

      // Register as virtual MCP tools
      for (const tool of connectedTools) {
        mcpClient.registerVirtualTool({
          serverId: COMPOSIO_MCP_SERVER_ID,
          serverName: 'Composio',
          name: `composio_${tool.slug}`,
          description: `[Composio] ${tool.description}`,
          inputSchema: tool.parameters || {},
        });
      }

      console.log(`[CapabilitySyncAdapter] Synced ${connectedTools.length} Composio tools from ${toolkitSlugs.length} accounts`);
    } catch (e) {
      console.error('[CapabilitySyncAdapter] Composio sync failed:', e);
    }
  }

  // Fetch exposed Zapier NLA actions and register each as a virtual tool
  private async syncZapierActions(apiKey: string): Promise<void> {
    if (!apiKey) return;

    // Sync the key to zapierNLA's own storage so direct calls work too
    await zapierNLA.setApiKey(apiKey);

    try {
      const actions = await zapierNLA.listActions(apiKey);

      if (actions.length === 0) {
        // Could be 401 (bad key) or no exposed actions
        // Validate the key to distinguish
        const valid = await zapierNLA.validate(apiKey);
        if (!valid) {
          console.warn('[CapabilitySyncAdapter] Zapier API key is invalid or expired — update at nla.zapier.com/credentials');
        }
        // Register static fallback tools so routing still works
        mcpClient.registerVirtualTool({
          serverId: 'connecthub_zapier',
          serverName: 'Zapier',
          name: 'trigger_zap',
          description: valid
            ? 'Zapier: Trigger a Zap action (no exposed actions found — configure at nla.zapier.com)'
            : 'Zapier: API key invalid — reconnect with a valid key from nla.zapier.com/credentials',
          inputSchema: {},
        });
        return;
      }

      for (const action of actions) {
        // Build an input schema from NLA param descriptions
        const properties: Record<string, { type: string; description: string }> = {};
        for (const [param, desc] of Object.entries(action.params)) {
          properties[param] = { type: 'string', description: desc };
        }

        mcpClient.registerVirtualTool({
          serverId: 'connecthub_zapier',
          serverName: 'Zapier',
          name: `zapier_nla_${action.id}`,
          description: `[Zapier] ${action.description}`,
          inputSchema: {
            type: 'object',
            properties,
          },
        });
      }

      console.log(`[CapabilitySyncAdapter] Synced ${actions.length} Zapier NLA actions`);
    } catch (e) {
      console.error('[CapabilitySyncAdapter] Zapier sync failed:', e);
      // Register static fallback so Zapier still shows as connected
      mcpClient.registerVirtualTool({
        serverId: 'connecthub_zapier',
        serverName: 'Zapier',
        name: 'trigger_zap',
        description: 'Zapier: Trigger a Zap (action discovery failed)',
        inputSchema: {},
      });
    }
  }

  getStatus(): { local: string[]; composio: string[]; syncing: boolean } {
    return {
      local: [...this.lastSync.localApps],
      composio: [...this.lastSync.composioTools],
      syncing: this.isSyncing,
    };
  }
}

// Singleton
export const capabilitySyncAdapter = new CapabilitySyncAdapterEngine();
