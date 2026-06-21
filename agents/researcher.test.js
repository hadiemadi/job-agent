// Proves agents/researcher.js makes zero network calls — it's a deliberate no-op stub until
// live web_search is enabled (see the TODO in that file). Mocks the Anthropic client and a
// generic fetch so any accidental network call would fail the test loudly.
jest.mock('../core/claude', () => ({
  client: { messages: { create: jest.fn() } },
  MODEL: 'claude-sonnet-4-6',
}));

const { client } = require('../core/claude');
const { research } = require('./researcher');

describe('researcher.research (no-op stub)', () => {
  test('returns empty findings without calling the Claude client', async () => {
    const result = await research('RF/Hardware Engineering');
    expect(result).toEqual({ skills: [], keywords: [], red_flags: [] });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  test('makes no global fetch call either', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn();
    try {
      await research('Embedded Software');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
