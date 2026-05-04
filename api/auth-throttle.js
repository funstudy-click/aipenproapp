// Login attempt throttling: 5 attempts per 15 minutes per email
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    res.status(500).json({
      error: 'Missing required server env vars.'
    });
    return;
  }

  const { email, action } = req.body || {};
  if (!email || !['check', 'record'].includes(action)) {
    res.status(400).json({ error: 'Missing email or action.' });
    return;
  }

  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  try {
    if (action === 'check') {
      // Count failed login attempts in last 15 minutes
      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/login_attempts?email=eq.${encodeURIComponent(email)}&created_at=gte.${fifteenMinutesAgo}&select=count`,
        {
          method: 'GET',
          headers: {
            apikey: supabaseServiceRoleKey,
            Authorization: `Bearer ${supabaseServiceRoleKey}`
          }
        }
      );

      if (!countRes.ok) {
        // Table might not exist yet; treat as 0 attempts
        return res.status(200).json({ blocked: false, attemptsRemaining: 5 });
      }

      const rows = await countRes.json();
      const attemptCount = rows?.[0]?.count || 0;
      const blocked = attemptCount >= 5;

      res.status(200).json({
        blocked,
        attemptsRemaining: Math.max(0, 5 - attemptCount)
      });
    } else if (action === 'record') {
      // Record a failed login attempt
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/login_attempts`, {
        method: 'POST',
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          created_at: now.toISOString()
        })
      });

      if (!insertRes.ok) {
        // Table might not exist; silently fail (don't block user)
        return res.status(200).json({ recorded: false });
      }

      res.status(200).json({ recorded: true });
    }
  } catch (error) {
    res.status(200).json({ error: 'Throttle check failed. Allowing request.' });
  }
}
