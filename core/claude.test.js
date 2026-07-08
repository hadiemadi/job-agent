// Confirms the metered client.messages.create() wrapper feeds its per-call cost into the
// CURRENT session's running total (services/session.js's addSessionSpend/getSessionSpend) —
// the data source behind the tailored CV page's "AI cost for this CV" line. Mocks both
// Anthropic SDK and llmClient so this never makes a real network call.
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      }),
    },
  }));
});

jest.mock('./llmClient', () => ({
  callDeepseek: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'deepseek ok' }],
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  }),
}));

// Set a high budget so individual tests don't trigger the spend cap before they run.
// DAILY_AI_BUDGET_USD is evaluated at require time, so this must precede the require below.
process.env.DAILY_AI_BUDGET_USD = '1000';

const { als, getSessionSpend } = require('../services/session');
const { client, getSpendToday, DAILY_AI_BUDGET_USD, meteredCreate } = require('./claude');
const { callDeepseek } = require('./llmClient');

test('getSpendToday() returns spendTodayUsd and DAILY_AI_BUDGET_USD', () => {
  const spend = getSpendToday();
  expect(typeof spend.spendTodayUsd).toBe('number');
  expect(spend.spendTodayUsd).toBeGreaterThanOrEqual(0);
  // DAILY_AI_BUDGET_USD default is 5 (overridable via env); must match the module's own const
  expect(spend.DAILY_AI_BUDGET_USD).toBe(DAILY_AI_BUDGET_USD);
  expect(spend.DAILY_AI_BUDGET_USD).toBeGreaterThan(0);
});

test('a metered call adds its cost to the current session, not a global total', async () => {
  await als.run('claude-test-sid', async () => {
    expect(getSessionSpend()).toBe(0);
    await client.messages.create({ model: 'claude-sonnet-4-6', messages: [] });
    // 1M input tokens @ $3/Mtok + 1M output tokens @ $15/Mtok (default pricing) = $18
    expect(getSessionSpend()).toBeCloseTo(18, 5);
  });

  // A different session never sees the first session's spend.
  await als.run('claude-test-sid-2', async () => {
    expect(getSessionSpend()).toBe(0);
  });
});

test('meteredCreate routes deepseek-* models to callDeepseek, not the Anthropic SDK', async () => {
  jest.clearAllMocks();
  await als.run('ds-route-test', async () => {
    const result = await meteredCreate({ model: 'deepseek-chat', messages: [], max_tokens: 100 });
    expect(callDeepseek).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-chat' })
    );
    expect(result.content[0].text).toBe('deepseek ok');
  });
});

test('DeepSeek pricing is $0.435/$0.87 per Mtok — session cost is lower than Claude default', async () => {
  jest.clearAllMocks();
  await als.run('ds-pricing-test', async () => {
    expect(getSessionSpend()).toBe(0);
    await meteredCreate({ model: 'deepseek-chat', messages: [], max_tokens: 100 });
    // Mock returns 1M input + 1M output; at DeepSeek rates: $0.435 + $0.87 = $1.305
    expect(getSessionSpend()).toBeCloseTo(1.305, 4);
  });
});
