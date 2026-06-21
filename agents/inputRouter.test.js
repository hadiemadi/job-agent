jest.mock('../core/claude', () => ({
  client: { messages: { create: jest.fn() } },
  MODEL: 'claude-sonnet-4-6',
}));

const { client } = require('../core/claude');
const { classify } = require('./inputRouter');

function mockBucket(bucket) {
  client.messages.create.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ bucket }) }] });
}

describe('inputRouter.classify', () => {
  beforeEach(() => client.messages.create.mockClear());

  test('"prefer one-page" classifies as General', async () => {
    mockBucket('general');
    const result = await classify('I prefer a one-page CV.');
    expect(result.bucket).toBe('general');
  });

  test('a field-specific skill claim classifies as Discipline', async () => {
    mockBucket('discipline');
    const result = await classify('I have hands-on GaN power amplifier tuning experience.');
    expect(result.bucket).toBe('discipline');
    expect(result.text).toBe('I have hands-on GaN power amplifier tuning experience.');
  });

  test('an empty comment returns bucket "none" without calling Claude', async () => {
    const result = await classify('   ');
    expect(result).toEqual({ bucket: 'none', text: '' });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  test('an unrecognized bucket value falls back to "ambiguous"', async () => {
    mockBucket('something-unexpected');
    const result = await classify('hard to tell');
    expect(result.bucket).toBe('ambiguous');
  });
});
