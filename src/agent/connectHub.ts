// 🔌 CONNECT HUB — Unified Connection Layer
// Composio-style abstraction over MCP, A2A, and Direct API connections
// Users pick an app, choose a method, and connect — no raw endpoints needed

// ── Types ────────────────────────────────────────────────────────────

export type ConnectionMethod = 'api' | 'mcp' | 'a2a';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AppDefinition {
  id: string;
  name: string;
  icon: string;
  category: AppCategory;
  description: string;
  methods: ConnectionMethod[];
  // Pre-configured connection details per method
  defaults: Partial<Record<ConnectionMethod, MethodDefaults>>;
}

export interface MethodDefaults {
  endpoint?: string;
  authType?: 'api_key' | 'oauth' | 'none';
  authUrl?: string;
  keyPlaceholder?: string;
  keyLink?: string;
  keyLabel?: string;
  description?: string;
  tools?: string[]; // capabilities this connection provides
}

export type AppCategory = 
  | 'productivity'
  | 'communication'
  | 'development'
  | 'ai'
  | 'data'
  | 'automation'
  | 'search'
  | 'social';

export interface AppConnection {
  appId: string;
  method: ConnectionMethod;
  status: ConnectionStatus;
  config: Record<string, string>;
  connectedAt?: string;
  lastUsed?: string;
  error?: string;
}

// ── App Registry ─────────────────────────────────────────────────────

export const APP_REGISTRY: AppDefinition[] = [
  // 🔍 Search & Browse
  {
    id: 'google-search',
    name: 'Google Search',
    icon: '🔍',
    category: 'search',
    description: 'Search the web via Google Custom Search API',
    methods: ['api'],
    defaults: {
      api: {
        authType: 'api_key',
        keyPlaceholder: 'AIza...',
        keyLink: 'https://console.cloud.google.com/apis/credentials',
        keyLabel: 'Google API Key',
        description: 'Uses Custom Search JSON API for programmatic web search.',
        tools: ['web_search', 'image_search'],
      },
    },
  },
  // 📧 Communication
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    category: 'communication',
    description: 'Read, send, and manage emails',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @anthropic/gmail-mcp',
        authType: 'oauth',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        description: 'Full Gmail access via MCP server. Requires OAuth.',
        tools: ['read_email', 'send_email', 'search_inbox', 'manage_labels'],
      },
      api: {
        authType: 'api_key',
        keyPlaceholder: 'Gmail App Password',
        keyLink: 'https://myaccount.google.com/apppasswords',
        keyLabel: 'App Password',
        description: 'Basic email via SMTP/IMAP. Limited features.',
        tools: ['send_email', 'read_email'],
      },
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    category: 'communication',
    description: 'Send messages, read channels, manage workspace',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @anthropic/slack-mcp',
        authType: 'oauth',
        description: 'Full Slack workspace access via MCP.',
        tools: ['send_message', 'read_channel', 'list_channels', 'search_messages'],
      },
      api: {
        authType: 'api_key',
        keyPlaceholder: 'xoxb-...',
        keyLink: 'https://api.slack.com/apps',
        keyLabel: 'Bot Token',
        description: 'Direct Slack API access via bot token.',
        tools: ['send_message', 'read_channel'],
      },
    },
  },
  // 🛠️ Development
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    category: 'development',
    description: 'Manage repos, issues, PRs, and code',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @anthropic/github-mcp',
        authType: 'api_key',
        keyPlaceholder: 'ghp_...',
        keyLink: 'https://github.com/settings/tokens',
        keyLabel: 'Personal Access Token',
        description: 'Full GitHub access via MCP server.',
        tools: ['create_issue', 'list_repos', 'create_pr', 'search_code', 'read_file'],
      },
      api: {
        authType: 'api_key',
        keyPlaceholder: 'ghp_...',
        keyLink: 'https://github.com/settings/tokens',
        keyLabel: 'Personal Access Token',
        description: 'Direct GitHub REST API access.',
        tools: ['create_issue', 'list_repos'],
      },
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: '📐',
    category: 'development',
    description: 'Project management — issues, sprints, teams',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @linear/mcp-server',
        authType: 'api_key',
        keyPlaceholder: 'lin_api_...',
        keyLink: 'https://linear.app/settings/api',
        keyLabel: 'API Key',
        description: 'Full Linear workspace access.',
        tools: ['create_issue', 'list_issues', 'update_issue', 'search'],
      },
    },
  },
  // 🤖 AI & Models
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🧠',
    category: 'ai',
    description: 'GPT models for text, code, and image generation',
    methods: ['api'],
    defaults: {
      api: {
        authType: 'api_key',
        keyPlaceholder: 'sk-...',
        keyLink: 'https://platform.openai.com/api-keys',
        keyLabel: 'API Key',
        description: 'Access GPT-4, DALL-E, Whisper, and more.',
        tools: ['chat_completion', 'image_generation', 'embeddings'],
      },
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🔮',
    category: 'ai',
    description: 'Claude models for analysis and reasoning',
    methods: ['api'],
    defaults: {
      api: {
        authType: 'api_key',
        keyPlaceholder: 'sk-ant-...',
        keyLink: 'https://console.anthropic.com/settings/keys',
        keyLabel: 'API Key',
        description: 'Access Claude 3.5 Sonnet, Haiku, and Opus.',
        tools: ['chat_completion', 'analysis'],
      },
    },
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    icon: '🤗',
    category: 'ai',
    description: 'Open-source models for vision, NLP, and embeddings',
    methods: ['api'],
    defaults: {
      api: {
        authType: 'api_key',
        keyPlaceholder: 'hf_...',
        keyLink: 'https://huggingface.co/settings/tokens',
        keyLabel: 'Access Token',
        description: 'Inference API for thousands of models.',
        tools: ['object_detection', 'text_classification', 'embeddings', 'ocr'],
      },
    },
  },
  // 📊 Data & Storage
  {
    id: 'notion',
    name: 'Notion',
    icon: '📝',
    category: 'productivity',
    description: 'Read and write Notion pages, databases, and blocks',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @anthropic/notion-mcp',
        authType: 'api_key',
        keyPlaceholder: 'ntn_...',
        keyLink: 'https://www.notion.so/my-integrations',
        keyLabel: 'Integration Token',
        description: 'Full Notion workspace access via MCP.',
        tools: ['read_page', 'create_page', 'query_database', 'search'],
      },
    },
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    icon: '📊',
    category: 'data',
    description: 'Read and write spreadsheet data',
    methods: ['mcp', 'api'],
    defaults: {
      mcp: {
        endpoint: 'npx @anthropic/sheets-mcp',
        authType: 'oauth',
        description: 'Full Sheets access via MCP server.',
        tools: ['read_sheet', 'write_cells', 'create_sheet'],
      },
    },
  },
  // 🔄 Automation
  {
    id: 'zapier',
    name: 'Zapier',
    icon: '⚡',
    category: 'automation',
    description: 'Connect to 7,000+ apps via your exposed Zap actions',
    methods: ['api'],
    defaults: {
      api: {
        authType: 'api_key',
        keyPlaceholder: 'Your Zapier NLA API Key',
        keyLink: 'https://nla.zapier.com/credentials/',
        keyLabel: 'NLA API Key',
        description: 'Natural Language Actions API — expose Zaps as AI-callable tools.',
        tools: ['trigger_zap', 'list_actions'],
      },
    },
  },
  // 🌐 Custom
  {
    id: 'custom-mcp',
    name: 'Custom MCP Server',
    icon: '🔌',
    category: 'automation',
    description: 'Connect any MCP-compatible server',
    methods: ['mcp'],
    defaults: {
      mcp: {
        authType: 'none',
        description: 'Paste any MCP server URL or npx command.',
        tools: [],
      },
    },
  },
  {
    id: 'custom-a2a',
    name: 'Custom A2A Agent',
    icon: '🤝',
    category: 'automation',
    description: 'Connect any A2A-compatible remote agent',
    methods: ['a2a'],
    defaults: {
      a2a: {
        authType: 'none',
        description: 'Paste the remote agent URL for A2A handshake.',
        tools: [],
      },
    },
  },
];

// ── Category metadata ────────────────────────────────────────────────

export const CATEGORY_META: Record<AppCategory, { label: string; icon: string }> = {
  search:        { label: 'Search',        icon: '🔍' },
  communication: { label: 'Communication', icon: '💬' },
  development:   { label: 'Development',   icon: '🛠️' },
  ai:            { label: 'AI & Models',   icon: '🤖' },
  data:          { label: 'Data',          icon: '📊' },
  productivity:  { label: 'Productivity',  icon: '📋' },
  automation:    { label: 'Automation',    icon: '⚡' },
  social:        { label: 'Social',        icon: '🌐' },
};

// ── Connection Manager ───────────────────────────────────────────────

const STORAGE_KEY = 'handoff_connections';

export class ConnectionManager {
  private connections: Map<string, AppConnection> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY] as AppConnection[] | undefined;
      if (saved) {
        for (const conn of saved) {
          this.connections.set(conn.appId, conn);
        }
      }
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    const arr = Array.from(this.connections.values());
    await chrome.storage.local.set({ [STORAGE_KEY]: arr });
  }

  async connect(appId: string, method: ConnectionMethod, config: Record<string, string>): Promise<AppConnection> {
    await this.init();

    const app = APP_REGISTRY.find(a => a.id === appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    if (!app.methods.includes(method)) throw new Error(`${app.name} doesn't support ${method}`);

    const connection: AppConnection = {
      appId,
      method,
      status: 'connecting',
      config,
      connectedAt: new Date().toISOString(),
    };

    this.connections.set(appId, connection);

    try {
      // Validate the connection based on method
      const valid = await this.validate(app, method, config);
      connection.status = valid ? 'connected' : 'error';
      if (!valid) connection.error = 'Validation failed — check credentials';
    } catch (e) {
      connection.status = 'error';
      connection.error = e instanceof Error ? e.message : 'Connection failed';
    }

    await this.persist();
    return connection;
  }

  async disconnect(appId: string): Promise<void> {
    await this.init();
    this.connections.delete(appId);
    await this.persist();
  }

  async getConnection(appId: string): Promise<AppConnection | null> {
    await this.init();
    return this.connections.get(appId) || null;
  }

  async getAllConnections(): Promise<AppConnection[]> {
    await this.init();
    return Array.from(this.connections.values());
  }

  async getConnectedApps(): Promise<AppDefinition[]> {
    await this.init();
    return APP_REGISTRY.filter(app => {
      const conn = this.connections.get(app.id);
      return conn?.status === 'connected';
    });
  }

  private async validate(app: AppDefinition, method: ConnectionMethod, config: Record<string, string>): Promise<boolean> {
    const defaults = app.defaults[method];

    if (method === 'mcp') {
      const endpoint = config.endpoint || defaults?.endpoint;
      if (!endpoint) return false;
      // Try to ping the MCP server via background worker
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'MCP_CLIENT_ADD_SERVER',
          payload: { id: app.id, name: app.name, url: endpoint, apiKey: config.apiKey || '' },
        });
        return res?.success === true;
      } catch {
        return false;
      }
    }

    if (method === 'a2a') {
      const endpoint = config.endpoint;
      if (!endpoint) return false;
      // Try A2A discovery
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'A2A_DISCOVER',
          payload: { endpoint, apiKey: config.apiKey || '' },
        });
        return res?.success === true;
      } catch {
        return false;
      }
    }

    if (method === 'api') {
      const key = config.apiKey || config.token;
      if (!key || key.length < 5) return false;

      // Live validation for Zapier NLA
      if (app.id === 'zapier') {
        try {
          const res = await fetch('https://nla.zapier.com/api/v1/exposed/', {
            headers: { 'x-api-key': key, Accept: 'application/json' },
          });
          if (res.status === 401 || res.status === 403) {
            console.error(`[ConnectHub] Zapier key rejected: HTTP ${res.status}`);
            return false;
          }
          if (!res.ok) {
            // NLA service might be down/deprecated — don't reject the key
            console.warn(`[ConnectHub] Zapier NLA endpoint returned ${res.status} — accepting key (service may be unavailable)`);
            return true;
          }
          return true;
        } catch (e) {
          // Network error — NLA endpoint unreachable, accept the key
          console.warn('[ConnectHub] Zapier NLA endpoint unreachable — accepting key:', e);
          return true;
        }
      }

      // Generic API key: just verify non-empty and long enough
      return true;
    }

    return false;
  }
}

// Singleton
let _manager: ConnectionManager | null = null;
export function getConnectionManager(): ConnectionManager {
  if (!_manager) _manager = new ConnectionManager();
  return _manager;
}
