const PAYPAL_BASE_URL = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET.');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Failed to get PayPal access token: ${body.slice(0, 300)}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function getAuthenticatedUser(supabaseUrl, supabaseServiceRoleKey, token) {
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!userRes.ok) {
    return null;
  }

  const user = await userRes.json();
  return user?.id ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.UPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    res.status(500).json({
      error: 'Missing required server env vars. Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Please login first.' });
    return;
  }

  const authUser = await getAuthenticatedUser(supabaseUrl, supabaseServiceRoleKey, token);
  if (!authUser) {
    res.status(401).json({ error: 'Invalid or expired session. Please login again.' });
    return;
  }

  if (!authUser.email_confirmed_at) {
    res.status(403).json({
      error: 'Please verify your email first. Check your inbox for the confirmation link.'
    });
    return;
  }

  try {
    const paypalToken = await getPayPalAccessToken();
    const amount = process.env.PAYPAL_PRO_PRICE_GBP || '9.00';

    const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paypalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: authUser.id,
            description: 'AIPenPro Pro plan (monthly billing handled in app settings)',
            amount: {
              currency_code: 'GBP',
              value: amount
            }
          }
        ]
      })
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      res.status(orderRes.status).json({
        error: orderData?.message || 'Failed to create PayPal order.',
        details: orderData
      });
      return;
    }

    res.status(200).json({ orderID: orderData.id });
  } catch (error) {
    res.status(500).json({
      error: 'Server error while creating PayPal order.',
      details: String(error)
    });
  }
}
