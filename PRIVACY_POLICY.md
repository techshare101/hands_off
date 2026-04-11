# HandOff Privacy Policy

**Last Updated:** April 11, 2026

## 1. Data Collection & Usage

HandOff is a Chrome Extension designed to operate locally within your browser. We prioritize your privacy and data sovereignty.

- **Local Storage Only:** All configuration, connection states, and telemetry metrics are stored exclusively in `chrome.storage.local`. No data is transmitted to external servers unless explicitly configured by you via MCP or A2A endpoints.
- **Telemetry:** The built-in telemetry dashboard tracks system health, tool usage, and service worker wakeups. This data remains strictly local and is used solely for performance monitoring and debugging.
- **LLM API Calls:** When you provide an API key for an LLM provider (Gemini, OpenAI, Anthropic, etc.), your prompts and page context are sent to that provider's API. HandOff does not intercept or store these payloads beyond what is needed for the active session.
- **External Connections:** HandOff may connect to third-party MCP servers, A2A agents, or Composio as configured by the user. These connections use your own credentials. We do not log or store payloads from these connections.

## 2. Permissions Justification

| Permission | Purpose |
|---|---|
| `activeTab` | Allows the agent to read and interact with the currently active tab when you start a task. |
| `tabs` | Enables tab management for multi-step workflows (finding target tabs, opening new ones). |
| `scripting` | Injects content scripts to read page content and perform browser actions on your behalf. |
| `storage` | Persists user settings, API keys, connection registry, and telemetry buffers locally. |
| `alarms` | Enables periodic telemetry flushing and background sync without keeping the service worker alive unnecessarily. |
| `sidePanel` | Provides the primary UI for task input, settings, Connect Hub, and telemetry dashboard. |
| `downloads` | Allows the agent to save files when tasks require downloading content. |
| `host_permissions: <all_urls>` | Required so the agent can interact with any website you direct it to. No data is collected from sites you do not actively task the agent with. |

## 3. Data Sharing & Third Parties

We do not sell, share, or transmit your data to third parties. Any data exchanged with external AI providers, MCP servers, or A2A agents is governed by your own API keys and endpoint configurations.

## 4. Data Retention

- All data is stored in `chrome.storage.local` and persists until you clear it.
- Telemetry buffers are automatically flushed every 15 minutes and can be reset at any time via Settings > Telemetry > Reset.
- Removing the extension from Chrome deletes all stored data.

## 5. User Rights

You retain full control over your data:
- **View:** Inspect stored data via Settings and Telemetry Dashboard.
- **Delete:** Reset telemetry data or clear all settings from within the extension.
- **Remove:** Uninstalling the extension removes all local data.

## 6. Contact

For privacy inquiries, contact: [your-email@domain.com]
