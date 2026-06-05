const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';

function normalizeGbpAmount(raw) {
  const source = String(raw || '9.00').trim();
  const cleaned = source.replace(/[^0-9.,-]/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return '9.00';
  return parsed.toFixed(2);
}

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
    amount: normalizeGbpAmount(process.env.PAYPAL_PRO_PRICE_GBP),
    env: PAYPAL_ENV
  });
}
