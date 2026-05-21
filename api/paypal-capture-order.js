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

async function upgradeUserToPro(supabaseUrl, supabaseServiceRoleKey, userId) {
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([
      {
        user_id: userId,
        plan: 'pro',
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!upsertRes.ok) {
    let errData = null;
    try {
      errData = await upsertRes.json();
    } catch (e) {
      errData = { message: 'Non-JSON response from Supabase.', parseError: String(e) };
    }
    throw new Error(`Failed to upgrade user plan: ${JSON.stringify(errData)}`);
  }
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

  const { orderID } = req.body || {};
  if (!orderID) {
    res.status(400).json({ error: 'Missing orderID.' });
    return;
  }

  try {
    const paypalToken = await getPayPalAccessToken();

    const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paypalToken}`,
        'Content-Type': 'application/json'
      }
    });

    const captureData = await captureRes.json();
    if (!captureRes.ok) {
      res.status(captureRes.status).json({
        error: captureData?.message || 'Failed to capture PayPal order.',
        details: captureData
      });
      return;
    }

    const captureStatus = captureData?.status;
    const purchaseUnit = captureData?.purchase_units?.[0] || null;
    const customId = purchaseUnit?.payments?.captures?.[0]?.custom_id || purchaseUnit?.custom_id || null;

    if (captureStatus !== 'COMPLETED') {
      res.status(400).json({
        error: 'Payment was not completed.',
        details: captureData
      });
      return;
    }

    if (customId && customId !== authUser.id) {
      res.status(403).json({
        error: 'Payment does not belong to the authenticated user.',
        details: { customId }
      });
      return;
    }

    await upgradeUserToPro(supabaseUrl, supabaseServiceRoleKey, authUser.id);

    res.status(200).json({
      ok: true,
      plan: 'pro',
      orderID,
      captureID: purchaseUnit?.payments?.captures?.[0]?.id || null
    });
  } catch (error) {
    res.status(500).json({
      error: 'Server error while capturing PayPal order.',
      details: String(error)
    });
  }
}
