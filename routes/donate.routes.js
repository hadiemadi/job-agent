'use strict';
const express = require('express');
const { logEvent } = require('../core/logger');
const { sendError } = require('../core/respondError');

const router = express.Router();

const VALID_AMOUNTS = new Set([1, 3, 5]);

// Lazily load Stripe so the app still boots when STRIPE_SECRET_KEY is unset
// (local dev / test environments). Any call to /donate without the key
// returns a clear 503 rather than crashing the process.
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

// POST /donate — creates a Stripe Checkout session for a one-time donation.
// No authentication required: works for logged-in and anonymous users alike.
// Nothing is unlocked on success; the thank-you page is a plain success_url.
router.post('/donate', async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!VALID_AMOUNTS.has(amount)) {
    return res.status(400).json({ error: 'Amount must be 1, 3, or 5 (USD).' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Payments are not configured on this server.' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    // returnUrl must be same-origin to prevent open redirect attacks.
    const rawReturn = req.body && req.body.returnUrl;
    const successUrl = (typeof rawReturn === 'string' && rawReturn.startsWith(origin))
      ? `${rawReturn}${rawReturn.includes('?') ? '&' : '?'}donated=1`
      : `${origin}/?donated=1`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Job Agent — Donation', description: 'Support the service. Thank you!' },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url:  `${origin}/`,
    });

    // Fire-and-forget — log the amount only, no PII
    logEvent('donation_initiated', { route: '/donate', outcome: 'ok', count: amount });

    res.json({ url: session.url });
  } catch (err) {
    sendError(res, '/donate', 'ERR-DONATE-001', err);
  }
});

module.exports = router;
