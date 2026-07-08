'use strict';

jest.mock('./errorCodes', () => ({
  taggedError: (code) => {
    const err = new Error('tagged:' + code);
    err.code   = code;
    err.status = code === 'ERR-RATE-001' ? 429 : 500;
    return err;
  },
}));

jest.mock('./logger', () => ({ logDiagnostic: jest.fn() }));

const { callDeepseek, normalizeDeepseekResponse, toDeepseekParams } = require('./llmClient');
const { firstText } = require('./json');

// ── normalizeDeepseekResponse ─────────────────────────────────────────────

describe('normalizeDeepseekResponse', () => {
  test('converts choices[0].message.content to Anthropic content block', () => {
    const raw = {
      id: 'ds-123',
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = normalizeDeepseekResponse(raw);
    expect(result.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(result.stop_reason).toBe('end_turn');
  });

  test('handles empty choices gracefully — returns empty text', () => {
    const result = normalizeDeepseekResponse({ choices: [], usage: {} });
    expect(result.content[0].text).toBe('');
    expect(result.usage.input_tokens).toBe(0);
  });

  test('normalized response works with firstText()', () => {
    const raw = { choices: [{ message: { content: 'Test output' }, finish_reason: 'stop' }], usage: {} };
    const normalized = normalizeDeepseekResponse(raw);
    expect(firstText(normalized)).toBe('Test output');
  });
});

// ── toDeepseekParams ──────────────────────────────────────────────────────

describe('toDeepseekParams', () => {
  test('moves Anthropic system param to messages[0] with role:system', () => {
    const params = {
      model: 'deepseek-chat',
      system: 'Be helpful',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    };
    const result = toDeepseekParams(params);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(result.max_tokens).toBe(100);
  });

  test('omits stop when array is empty', () => {
    const result = toDeepseekParams({ model: 'deepseek-chat', messages: [], stop: [] });
    expect(result).not.toHaveProperty('stop');
  });

  test('includes stop when non-empty', () => {
    const result = toDeepseekParams({ model: 'deepseek-chat', messages: [], stop: ['END'] });
    expect(result.stop).toEqual(['END']);
  });
});

// ── callDeepseek ──────────────────────────────────────────────────────────

describe('callDeepseek', () => {
  let originalFetch;
  let originalKey;

  beforeAll(() => {
    originalFetch = global.fetch;
    originalKey   = process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    jest.clearAllMocks();
  });

  test('throws with status 503 when DEEPSEEK_API_KEY is not set', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(callDeepseek({ model: 'deepseek-chat', messages: [], max_tokens: 100 }))
      .rejects.toMatchObject({ status: 503 });
  });

  test('calls the DeepSeek endpoint and returns a normalized Anthropic-shaped response', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Hello from DeepSeek' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    });
    const result = await callDeepseek({
      model: 'deepseek-chat',
      system: 'Be helpful',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    });
    expect(result.content[0].text).toBe('Hello from DeepSeek');
    expect(result.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('passes Authorization header with the API key', async () => {
    process.env.DEEPSEEK_API_KEY = 'my-secret-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      }),
    });
    await callDeepseek({ model: 'deepseek-chat', messages: [], max_tokens: 10 });
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-secret-key');
  });

  test('throws ERR-RATE-001 on 429 from DeepSeek API', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 429, text: jest.fn().mockResolvedValue('rate limit'),
    });
    await expect(callDeepseek({ model: 'deepseek-chat', messages: [], max_tokens: 100 }))
      .rejects.toMatchObject({ code: 'ERR-RATE-001' });
  });

  test('throws ERR-SYS-001 on non-429 API error', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: jest.fn().mockResolvedValue('internal error'),
    });
    await expect(callDeepseek({ model: 'deepseek-chat', messages: [], max_tokens: 100 }))
      .rejects.toMatchObject({ code: 'ERR-SYS-001' });
  });

  test('throws ERR-SYS-001 on network error', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(callDeepseek({ model: 'deepseek-chat', messages: [], max_tokens: 100 }))
      .rejects.toMatchObject({ code: 'ERR-SYS-001' });
  });
});
