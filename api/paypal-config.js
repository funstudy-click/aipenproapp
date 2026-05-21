const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'Missing PAYPAL_CLIENT_ID server env var.' });
    return;
  }

  res.status(200).json({
    clientId,
    currency: 'GBP',
    amount: process.env.PAYPAL_PRO_PRICE_GBP || '9.00',
    env: PAYPAL_ENV
  });
}
