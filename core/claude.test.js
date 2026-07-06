// Confirms the metered client.messages.create() wrapper feeds its per-call cost into the
// CURRENT session's running total (services/session.js's addSessionSpend/getSessionSpend) —
// the data source behind the tailored CV page's "AI cost for this CV" line. Mocks the
// Anthropic SDK so this never makes a real network call.
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

const { als, getSessionSpend } = require('../services/session');
const { client, getSpendToday, DAILY_AI_BUDGET_USD } = require('./claude');

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
