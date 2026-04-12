// ZapierNLA Integration Tests
// Validates authentication, action listing, and action execution via mocked fetch

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
  },
});

// ── Mock fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Import after mocks ─────────────────────────────────────────────

const { zapierNLA } = await import('../zapierNLA');

// ── Helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ZapierNLA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(storageData)) delete storageData[k];
  });

  // ── validate ────────────────────────────────────────────────────

  it('validate returns true for valid API key', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

    const valid = await zapierNLA.validate('test_key_123');
    expect(valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://nla.zapier.com/api/v1/exposed/',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'test_key_123' }),
      }),
    );
  });

  it('validate returns false for invalid API key', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}, 401));

    const valid = await zapierNLA.validate('bad_key');
    expect(valid).toBe(false);
  });

  it('validate returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const valid = await zapierNLA.validate('any_key');
    expect(valid).toBe(false);
  });

  it('validate returns false with empty key', async () => {
    const valid = await zapierNLA.validate('');
    expect(valid).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── listActions ─────────────────────────────────────────────────

  it('listActions returns parsed actions', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        results: [
          { id: 'act_1', description: 'Send a Slack message', params: { message: 'The message text', channel: 'Slack channel' } },
          { id: 'act_2', description: 'Create a Trello card', params: { title: 'Card title' } },
        ],
      }),
    );

    const actions = await zapierNLA.listActions('key_123');

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      id: 'act_1',
      description: 'Send a Slack message',
      params: { message: 'The message text', channel: 'Slack channel' },
    });
    expect(actions[1].id).toBe('act_2');
  });

  it('listActions returns empty array on API error', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}, 403));

    const actions = await zapierNLA.listActions('bad_key');
    expect(actions).toEqual([]);
  });

  it('listActions returns empty array with no key', async () => {
    const actions = await zapierNLA.listActions('');
    expect(actions).toEqual([]);
  });

  it('listActions handles missing params gracefully', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        results: [{ id: 'act_3', description: 'No params action' }],
      }),
    );

    const actions = await zapierNLA.listActions('key_123');
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toEqual({});
  });

  // ── executeAction ───────────────────────────────────────────────

  it('executeAction sends params and returns result', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: 'exec_1',
        action_used: 'act_1',
        result: { message_sent: true },
      }),
    );

    const result = await zapierNLA.executeAction(
      'act_1',
      { message: 'Hello', channel: '#general' },
      undefined,
      'key_123',
    );

    expect(result.status).toBe('success');
    expect(result.result).toEqual({ message_sent: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://nla.zapier.com/api/v1/exposed/act_1/execute/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Hello', channel: '#general' }),
      }),
    );
  });

  it('executeAction includes instructions when provided', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ id: 'exec_2', action_used: 'act_1', result: {} }),
    );

    await zapierNLA.executeAction(
      'act_1',
      { message: 'Hi' },
      'Send this to the #random channel',
      'key_123',
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.instructions).toBe('Send this to the #random channel');
    expect(callBody.message).toBe('Hi');
  });

  it('executeAction returns error on API failure', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse('Rate limited', 429));

    const result = await zapierNLA.executeAction('act_1', {}, undefined, 'key_123');

    expect(result.status).toBe('error');
    expect(result.error).toContain('429');
  });

  it('executeAction returns error with no API key', async () => {
    const result = await zapierNLA.executeAction('act_1', {}, undefined, '');

    expect(result.status).toBe('error');
    expect(result.error).toContain('No API key');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── API key persistence ─────────────────────────────────────────

  it('setApiKey persists to chrome.storage.local', async () => {
    await zapierNLA.setApiKey('my_zapier_key');

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ zapier_nla_api_key: 'my_zapier_key' }),
    );
  });

  it('getApiKey returns what was previously set', async () => {
    await zapierNLA.setApiKey('round_trip_key');
    const key = await zapierNLA.getApiKey();
    expect(key).toBe('round_trip_key');
  });
});
