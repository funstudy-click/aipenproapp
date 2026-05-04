export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid or expired session. Please login again.' });
    return;
  }

  const authUser = await userRes.json();
  const userId = authUser?.id;
  if (!userId) {
    res.status(401).json({ error: 'User not found for this session.' });
    return;
  }

  // Check if email is verified
  if (!authUser.email_confirmed_at) {
    res.status(403).json({ 
      error: 'Please verify your email first.' 
    });
    return;
  }

  // Get user plan
  let limit = 5;
  try {
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?user_id=eq.${userId}&select=plan`, {
      method: 'GET',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`
      }
    });

    if (profileRes.ok) {
      const profiles = await profileRes.json();
      if (profiles?.[0]?.plan === 'pro') {
        limit = 9999;
      }
    }
  } catch (_) {
    // Default to free
  }
  const today = new Date().toISOString().split('T')[0];

  const usageRes = await fetch(`${supabaseUrl}/rest/v1/usage_daily?user_id=eq.${userId}&usage_date=eq.${today}&select=count`, {
    method: 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`
    }
  });

  if (!usageRes.ok) {
    const usageErr = await usageRes.json();
    if (usageErr?.code === '42P01') {
      res.status(500).json({
        error: 'usage_daily table not found. Run setup SQL in README before deploying auth limits.'
      });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch usage.' });
    return;
  }

  const usageRows = await usageRes.json();
  const count = usageRows?.[0]?.count || 0;
  const remaining = Math.max(0, limit - count);

  res.status(200).json({ count, remaining, limit });
}
