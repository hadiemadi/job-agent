'use strict';

// Build a minimal express app with only the donate router so the test doesn't need
// to mock the full server's deps (passport, DB, AI modules, etc.)
const express = require('express');
const request = require('supertest');

// ── Stripe mock ───────────────────────────────────────────────────────────────
// Mock before requiring the router so getStripe() picks up the stub.
const mockSessionCreate = jest.fn();
jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: mockSessionCreate,
      },
    },
  }));
});

// ── Supporting mocks ──────────────────────────────────────────────────────────
jest.mock('../core/logger', () => ({ logEvent: jest.fn() }));
jest.mock('../core/respondError', () => ({
  sendError: jest.fn((res, route, code, err) => res.status(500).json({ error: err && err.message })),
}));

const donateRouter = require('./donate.routes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(donateRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: STRIPE_SECRET_KEY set so getStripe() returns the stub
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  mockSessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/mock-session' });
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

describe('POST /donate — amount validation', () => {
  test('rejects amount 0', async () => {
    const res = await request(makeApp()).post('/donate').send({ amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1, 3, or 5/);
  });

  test('rejects amount 2', async () => {
    const res = await request(makeApp()).post('/donate').send({ amount: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1, 3, or 5/);
  });

  test('rejects amount 10', async () => {
    const res = await request(makeApp()).post('/donate').send({ amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1, 3, or 5/);
  });

  test('rejects non-numeric string', async () => {
    const res = await request(makeApp()).post('/donate').send({ amount: 'abc' });
    expect(res.status).toBe(400);
  });

  test('rejects missing amount', async () => {
    const res = await request(makeApp()).post('/donate').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /donate — valid amounts redirect to Stripe', () => {
  test.each([1, 3, 5])('amount $%i returns Stripe session URL', async (amount) => {
    const res = await request(makeApp()).post('/donate').send({ amount });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/stripe\.com/);
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: expect.arrayContaining([
          expect.objectContaining({
            price_data: expect.objectContaining({ unit_amount: amount * 100 }),
          }),
        ]),
      })
    );
  });
});

describe('POST /donate — no login required', () => {
  test('succeeds with no cookie/session header', async () => {
    const res = await request(makeApp())
      .post('/donate')
      .send({ amount: 3 });
    // No auth → still returns 200 with the Stripe URL
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });
});

describe('POST /donate — Stripe not configured', () => {
  test('returns 503 when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    // Must re-require the router so the module cache is fresh without the key.
    // Jest module registry: reset between describe blocks is not guaranteed without
    // jest.resetModules(); we work around this by testing the 503 path via the
    // lazy getStripe() check which returns null when the key is absent.
    // Since the module is already cached with the key set in beforeEach, we test
    // the 503 path by temporarily removing the key AND clearing the require cache.
    jest.resetModules();
    jest.mock('stripe', () => jest.fn(() => ({ checkout: { sessions: { create: jest.fn() } } })));
    jest.mock('../core/logger', () => ({ logEvent: jest.fn() }));
    jest.mock('../core/respondError', () => ({
      sendError: jest.fn((res, route, code, err) => res.status(500).json({ error: err && err.message })),
    }));
    const freshRouter = require('./donate.routes');
    const app = express();
    app.use(express.json());
    app.use(freshRouter);

    const res = await request(app).post('/donate').send({ amount: 3 });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
