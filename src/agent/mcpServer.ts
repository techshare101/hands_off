// 🔌 MCP SERVER — Expose HandOff as an MCP-compatible tool server
// External agents (Claude Desktop, Cursor, other MCP clients) can connect
// and use HandOff's browser automation as a tool
//
// Architecture:
// - Chrome extension runs a WebSocket server via a native messaging host OR
// - Exposes tools via chrome.runtime.onMessageExternal (extension-to-extension)
// - For v1: uses a simple HTTP-like protocol over chrome messaging
//
// MCP Protocol: https://modelcontextprotocol.io/specification
// We implement a subset: tools/list, tools/call, resources/list

const STORAGE_KEY_MCP_CONFIG = 'handoff_mcp_config';

// ── Types ───────────────────────────────────────────────────────────

export interface MCPServerConfig {
  enabled: boolean;
  allowedOrigins: string[]; // extension IDs that can connect
  requireAuth: boolean;
  authToken?: string;
  exposedTools: string[]; // which tools to expose
  maxConcurrentRequests: number;
  logRequests: boolean;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required?: string[];
  };
}

export interface MCPPropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ── Tool Definitions ────────────────────────────────────────────────
// These are the tools that external agents can call

const HANDOFF_TOOLS: MCPToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click at a position on the current page',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate to click' },
        y: { type: 'number', description: 'Y coordinate to click' },
        selector: { type: 'string', description: 'Optional CSS selector to click instead of coordinates' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text at the current cursor position or a specific element',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        x: { type: 'number', description: 'X coordinate (optional)' },
        y: { type: 'number', description: 'Y coordinate (optional)' },
        selector: { type: 'string', description: 'Optional CSS selector to type into' },
        pressEnter: { type: 'boolean', description: 'Press Enter after typing', default: false },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page and return as base64',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: 'Capture full page (true) or viewport only (false)', default: false },
      },
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page in a direction',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'Scroll direction', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Scroll amount in pixels', default: 500 },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape, ArrowDown)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_get_page_info',
    description: 'Get current page URL, title, and metadata',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_extract_text',
    description: 'Extract visible text content from the current page',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to extract text from' },
        maxLength: { type: 'number', description: 'Max characters to return', default: 5000 },
      },
    },
  },
  {
    name: 'run_task',
    description: 'Run a full autonomous browser task. HandOff will navigate, click, type, and complete multi-step tasks on its own.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Natural language description of the task to perform' },
        maxSteps: { type: 'number', description: 'Maximum number of steps before stopping', default: 30 },
      },
      required: ['task'],
    },
  },
  {
    name: 'api_call',
    description: 'Make an HTTP request to an external API',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        url: { type: 'string', description: 'Full URL to call' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'object', description: 'Request body (for POST/PUT/PATCH)' },
      },
      required: ['method', 'url'],
    },
  },
  {
    name: 'generate_file',
    description: 'Generate and download a file',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Name of the file to generate' },
        content: { type: 'string', description: 'File content' },
        mimeType: { type: 'string', description: 'MIME type of the file' },
      },
      required: ['filename', 'content'],
    },
  },
];

// ── MCP Resources ───────────────────────────────────────────────────

const HANDOFF_RESOURCES: MCPResource[] = [
  {
    uri: 'handoff://page/screenshot',
    name: 'Current Page Screenshot',
    description: 'Screenshot of the currently active browser tab',
    mimeType: 'image/png',
  },
  {
    uri: 'handoff://page/text',
    name: 'Current Page Text',
    description: 'Extracted text content from the active tab',
    mimeType: 'text/plain',
  },
  {
    uri: 'handoff://page/info',
    name: 'Current Page Info',
    description: 'URL, title, and metadata of the active tab',
    mimeType: 'application/json',
  },
  {
    uri: 'handoff://skills',
    name: 'Available Skills',
    description: 'List of learned and recorded skills',
    mimeType: 'application/json',
  },
];

// ── MCP Server Engine ───────────────────────────────────────────────

class MCPServerEngine {
  private config: MCPServerConfig = {
    enabled: false,
    allowedOrigins: [],
    requireAuth: false,
    exposedTools: HANDOFF_TOOLS.map(t => t.name),
    maxConcurrentRequests: 5,
    logRequests: true,
  };
  private activeRequests = 0;
  private initialized = false;
  private requestLog: Array<{ timestamp: number; method: string; success: boolean }> = [];

  // Tool handlers — these get wired up by agentCore/worker
  private toolHandlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_MCP_CONFIG);
      if (result[STORAGE_KEY_MCP_CONFIG]) {
        this.config = { ...this.config, ...result[STORAGE_KEY_MCP_CONFIG] };
      }
      this.initialized = true;
      console.log(`[MCP Server] Initialized: enabled=${this.config.enabled}`);
    } catch {
      this.initialized = true;
    }
  }

  // ── External Message Handler ──────────────────────────────────────
  // Called by chrome.runtime.onMessageExternal

  async handleExternalMessage(
    request: MCPRequest,
    senderId?: string
  ): Promise<MCPResponse> {
    await this.init();

    if (!this.config.enabled) {
      return this.errorResponse(request.id, -32600, 'MCP Server is disabled');
    }

    // Auth check
    if (this.config.requireAuth) {
      const token = (request.params as Record<string, string>)?._auth;
      if (token !== this.config.authToken) {
        return this.errorResponse(request.id, -32600, 'Authentication failed');
      }
    }

    // Origin check
    if (senderId && this.config.allowedOrigins.length > 0) {
      if (!this.config.allowedOrigins.includes(senderId)) {
        return this.errorResponse(request.id, -32600, `Origin not allowed: ${senderId}`);
      }
    }

    // Rate limit
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      return this.errorResponse(request.id, -32000, 'Too many concurrent requests');
    }

    this.activeRequests++;

    try {
      const result = await this.routeRequest(request);

      if (this.config.logRequests) {
        this.requestLog.push({ timestamp: Date.now(), method: request.method, success: !result.error });
        if (this.requestLog.length > 500) this.requestLog = this.requestLog.slice(-500);
      }

      return result;
    } finally {
      this.activeRequests--;
    }
  }

  // ── Request Router ────────────────────────────────────────────────

  private async routeRequest(request: MCPRequest): Promise<MCPResponse> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);

      case 'tools/list':
        return this.handleToolsList(request);

      case 'tools/call':
        return this.handleToolsCall(request);

      case 'resources/list':
        return this.handleResourcesList(request);

      case 'resources/read':
        return this.handleResourcesRead(request);

      case 'ping':
        return { jsonrpc: '2.0', id: request.id, result: { status: 'ok' } };

      default:
        return this.errorResponse(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  // ── Protocol Handlers ─────────────────────────────────────────────

  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: 'handoff-browser-agent',
          version: '1.0.0',
        },
      },
    };
  }

  private handleToolsList(request: MCPRequest): MCPResponse {
    const exposedTools = HANDOFF_TOOLS.filter(t => this.config.exposedTools.includes(t.name));
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools: exposedTools },
    };
  }

  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    if (!params?.name) {
      return this.errorResponse(request.id, -32602, 'Missing tool name');
    }

    if (!this.config.exposedTools.includes(params.name)) {
      return this.errorResponse(request.id, -32602, `Tool not exposed: ${params.name}`);
    }

    const handler = this.toolHandlers.get(params.name);
    if (!handler) {
      return this.errorResponse(request.id, -32602, `No handler registered for: ${params.name}`);
    }

    try {
      const result = await handler(params.arguments || {});
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: typeof result === 'string' ? 'text' : 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      return this.errorResponse(
        request.id,
        -32000,
        error instanceof Error ? error.message : 'Tool execution failed'
      );
    }
  }

  private handleResourcesList(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { resources: HANDOFF_RESOURCES },
    };
  }

  private async handleResourcesRead(request: MCPRequest): Promise<MCPResponse> {
    const uri = (request.params as { uri: string })?.uri;
    if (!uri) {
      return this.errorResponse(request.id, -32602, 'Missing resource URI');
    }

    const handler = this.toolHandlers.get(`resource:${uri}`);
    if (handler) {
      const result = await handler({});
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          contents: [
            {
              uri,
              text: typeof result === 'string' ? result : JSON.stringify(result),
              mimeType: HANDOFF_RESOURCES.find(r => r.uri === uri)?.mimeType || 'text/plain',
            },
          ],
        },
      };
    }

    return this.errorResponse(request.id, -32602, `Resource not found: ${uri}`);
  }

  // ── Tool Handler Registration ─────────────────────────────────────
  // agentCore/worker registers handlers for each tool

  registerToolHandler(name: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void {
    this.toolHandlers.set(name, handler);
    console.log(`[MCP Server] Registered handler: ${name}`);
  }

  registerResourceHandler(uri: string, handler: () => Promise<unknown>): void {
    this.toolHandlers.set(`resource:${uri}`, handler as (params: Record<string, unknown>) => Promise<unknown>);
  }

  // ── Configuration ─────────────────────────────────────────────────

  async getConfig(): Promise<MCPServerConfig> {
    await this.init();
    return { ...this.config };
  }

  async setConfig(update: Partial<MCPServerConfig>): Promise<void> {
    await this.init();
    this.config = { ...this.config, ...update };
    await chrome.storage.local.set({ [STORAGE_KEY_MCP_CONFIG]: this.config });
  }

  async isEnabled(): Promise<boolean> {
    await this.init();
    return this.config.enabled;
  }

  getAvailableTools(): MCPToolDefinition[] {
    return HANDOFF_TOOLS;
  }

  getStats(): { totalRequests: number; successRate: number; activeRequests: number; registeredHandlers: number } {
    const total = this.requestLog.length;
    const successful = this.requestLog.filter(r => r.success).length;
    return {
      totalRequests: total,
      successRate: total > 0 ? successful / total : 0,
      activeRequests: this.activeRequests,
      registeredHandlers: this.toolHandlers.size,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private errorResponse(id: string | number, code: number, message: string): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
  }
}

// Singleton
export const mcpServer = new MCPServerEngine();
