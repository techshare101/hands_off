// ═══════════════════════════════════════════════════════════════════════════
// MCP Client — Connect HandOff to external MCP servers
// Allows the agent to discover and use tools from any MCP-compliant server.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'handoff_mcp_client_config';

// ── Types ─────────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;             // Server endpoint (HTTP/SSE)
  transport: 'http' | 'sse';
  apiKey?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
}

interface MCPJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── MCP Client Engine ─────────────────────────────────────────────────────

class MCPClientEngine {
  private servers: Map<string, MCPServerConfig> = new Map();
  private toolCache: Map<string, MCPTool[]> = new Map();
  private resourceCache: Map<string, MCPResource[]> = new Map();
  private initialized = false;
  private requestId = 0;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const configs: MCPServerConfig[] = result[STORAGE_KEY] || [];
      configs.forEach(c => this.servers.set(c.id, c));
      this.initialized = true;
      console.log(`[MCPClient] Initialized with ${this.servers.size} servers`);
    } catch {
      this.initialized = true;
    }
  }

  // ── Server Management ──────────────────────────────────────────────

  async addServer(config: Omit<MCPServerConfig, 'id'>): Promise<MCPServerConfig> {
    await this.init();
    const server: MCPServerConfig = {
      ...config,
      id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    this.servers.set(server.id, server);
    await this.saveConfig();
    console.log(`[MCPClient] Added server: ${server.name} (${server.url})`);
    return server;
  }

  async removeServer(serverId: string): Promise<void> {
    this.servers.delete(serverId);
    this.toolCache.delete(serverId);
    this.resourceCache.delete(serverId);
    await this.saveConfig();
  }

  async updateServer(serverId: string, updates: Partial<MCPServerConfig>): Promise<void> {
    const existing = this.servers.get(serverId);
    if (!existing) throw new Error(`Server ${serverId} not found`);
    this.servers.set(serverId, { ...existing, ...updates, id: serverId });
    await this.saveConfig();
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getEnabledServers(): MCPServerConfig[] {
    return this.getServers().filter(s => s.enabled);
  }

  // ── JSON-RPC Communication ─────────────────────────────────────────

  private async sendRequest(server: MCPServerConfig, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request: MCPJsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      ...(params ? { params } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(server.headers || {}),
    };
    if (server.apiKey) {
      headers['Authorization'] = `Bearer ${server.apiKey}`;
    }

    const res = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw new Error(`MCP server ${server.name} returned ${res.status}: ${res.statusText}`);
    }

    const response: MCPJsonRpcResponse = await res.json();

    if (response.error) {
      throw new Error(`MCP error from ${server.name}: ${response.error.message} (code ${response.error.code})`);
    }

    return response.result;
  }

  // ── Tool Discovery ─────────────────────────────────────────────────

  async discoverTools(serverId?: string): Promise<MCPTool[]> {
    await this.init();
    const servers = serverId
      ? [this.servers.get(serverId)].filter(Boolean) as MCPServerConfig[]
      : this.getEnabledServers();

    const allTools: MCPTool[] = [];

    for (const server of servers) {
      try {
        const result = await this.sendRequest(server, 'tools/list') as { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] };
        const tools = (result.tools || []).map(t => ({
          ...t,
          serverId: server.id,
          serverName: server.name,
        }));
        this.toolCache.set(server.id, tools);
        allTools.push(...tools);
        console.log(`[MCPClient] Discovered ${tools.length} tools from ${server.name}`);
      } catch (error) {
        console.error(`[MCPClient] Failed to discover tools from ${server.name}:`, error);
      }
    }

    return allTools;
  }

  // ── Tool Execution ─────────────────────────────────────────────────

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    await this.init();
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);
    if (!server.enabled) throw new Error(`Server ${server.name} is disabled`);

    console.log(`[MCPClient] Calling tool ${toolName} on ${server.name}`);
    const result = await this.sendRequest(server, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    return result;
  }

  // ── Resource Discovery ─────────────────────────────────────────────

  async discoverResources(serverId?: string): Promise<MCPResource[]> {
    await this.init();
    const servers = serverId
      ? [this.servers.get(serverId)].filter(Boolean) as MCPServerConfig[]
      : this.getEnabledServers();

    const allResources: MCPResource[] = [];

    for (const server of servers) {
      try {
        const result = await this.sendRequest(server, 'resources/list') as { resources: { uri: string; name: string; description?: string; mimeType?: string }[] };
        const resources = (result.resources || []).map(r => ({
          ...r,
          serverId: server.id,
        }));
        this.resourceCache.set(server.id, resources);
        allResources.push(...resources);
      } catch (error) {
        console.error(`[MCPClient] Failed to discover resources from ${server.name}:`, error);
      }
    }

    return allResources;
  }

  // ── Resource Access ────────────────────────────────────────────────

  async readResource(serverId: string, uri: string): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);
    return this.sendRequest(server, 'resources/read', { uri });
  }

  // ── Server Health Check ────────────────────────────────────────────

  async pingServer(serverId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const server = this.servers.get(serverId);
    if (!server) return { ok: false, latencyMs: 0, error: 'Server not found' };

    const start = performance.now();
    try {
      await this.sendRequest(server, 'ping');
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch (error) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ── Cached Tool Lookup ─────────────────────────────────────────────

  getAllCachedTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    this.toolCache.forEach(t => tools.push(...t));
    return tools;
  }

  findTool(toolName: string): MCPTool | undefined {
    return this.getAllCachedTools().find(t => t.name === toolName);
  }

  // ── Agent Prompt Integration ───────────────────────────────────────

  formatToolsForPrompt(): string {
    const tools = this.getAllCachedTools();
    if (tools.length === 0) return '';

    return `\n[MCP TOOLS AVAILABLE]: ${tools.length} external tools from ${this.getEnabledServers().length} servers:\n` +
      tools.map(t => `  - ${t.serverName}::${t.name}: ${t.description}`).join('\n') +
      '\nYou can call these tools using MCP to perform actions on external services.\n';
  }

  // ── Persistence ────────────────────────────────────────────────────

  private async saveConfig(): Promise<void> {
    const configs = Array.from(this.servers.values()).map(s => ({
      ...s,
      apiKey: s.apiKey, // In production, encrypt this
    }));
    await chrome.storage.local.set({ [STORAGE_KEY]: configs });
  }

  // ── Stats ──────────────────────────────────────────────────────────

  getStats(): { servers: number; enabledServers: number; cachedTools: number } {
    return {
      servers: this.servers.size,
      enabledServers: this.getEnabledServers().length,
      cachedTools: this.getAllCachedTools().length,
    };
  }
}

// Singleton
export const mcpClient = new MCPClientEngine();
