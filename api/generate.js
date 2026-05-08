export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.UPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.HUGGINGFACE_API_TOKEN || process.env.HUGGINGFACE_API_TOKEN_HERE;
  if (!apiKey || !supabaseUrl || !supabaseServiceRoleKey) {
    res.status(500).json({
      error: 'Missing required server env vars. Required: HUGGINGFACE_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.'
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
      error: 'Please verify your email first. Check your inbox for the confirmation link.' 
    });
    return;
  }

  const { system, user } = req.body || {};
  if (!system || !user) {
    res.status(400).json({ error: 'Missing system or user prompt.' });
    return;
  }

  // Get user plan from profiles table
  let limit = 5;
  try {
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?user_id=eq.${userId}&select=plan`, {
      method: 'GET',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (profileRes.ok) {
      const profiles = await profileRes.json();
      if (profiles?.[0]?.plan === 'pro') {
        limit = 9999; // Unlimited for pro users
      }
    }
  } catch (_) {
    // If profile check fails, default to free limit
  }
  const today = new Date().toISOString().split('T')[0];

  const usageRes = await fetch(`${supabaseUrl}/rest/v1/usage_daily?user_id=eq.${userId}&usage_date=eq.${today}&select=count`, {
    method: 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!usageRes.ok) {
    let usageErr = null;
    try {
      usageErr = await usageRes.json();
    } catch (e) {
      usageErr = { message: 'Non-JSON error response from Supabase REST API.' };
    }

    const errCode = usageErr?.code || '';
    if (errCode === '42P01' || errCode === 'PGRST205') {
      res.status(500).json({
        error: 'usage_daily table not found or not exposed in Data API. Run setup SQL and ensure table is in exposed schema.',
        details: usageErr
      });
      return;
    }
    res.status(500).json({
      error: 'Failed to read usage limits.',
      details: usageErr
    });
    return;
  }

  const usageRows = await usageRes.json();
  const currentCount = usageRows?.[0]?.count || 0;
  if (currentCount >= limit) {
    res.status(429).json({ error: 'Daily free limit reached. Please upgrade to Pro.', remaining: 0 });
    return;
  }

  // This provider currently rejects some legacy Mistral model IDs.
  // Override with HUGGINGFACE_MODEL in Vercel env vars when needed.
  const model = process.env.HUGGINGFACE_MODEL || 'gpt2';
  const hfUrl = `https://router.huggingface.co/hf-inference/models/${model}`;
  const prompt = `${system}\n\n${user}`;

  try {
    const hfRes = await fetch(hfUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 500,
          temperature: 0.7,
          top_p: 0.9
        }
      })
    });

    const contentType = hfRes.headers.get('content-type') || '';
    const rawBody = await hfRes.text();
    let data = null;

    try {
      data = JSON.parse(rawBody);
    } catch (_e) {
      data = null;
    }

    if (!data) {
      res.status(hfRes.ok ? 502 : hfRes.status).json({
        error: hfRes.ok
          ? 'Hugging Face returned a non-JSON response.'
          : 'Hugging Face API request failed with non-JSON response.',
        details: {
          endpoint: hfUrl,
          contentType,
          preview: rawBody.slice(0, 300)
        }
      });
      return;
    }

    if (!hfRes.ok) {
      res.status(hfRes.status).json({
        error: data?.error || 'Hugging Face API request failed.',
        details: {
          model,
          endpoint: hfUrl,
          response: data
        }
      });
      return;
    }

    const fullText = data?.[0]?.generated_text || data?.generated_text || '';
    const text = fullText.replace(prompt, '').trim();

    // Count usage only after successful text generation.
    if (usageRows.length > 0) {
      const nextCount = currentCount + 1;
      const patchRes = await fetch(`${supabaseUrl}/rest/v1/usage_daily?user_id=eq.${userId}&usage_date=eq.${today}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ count: nextCount })
      });
      if (!patchRes.ok) {
        res.status(500).json({ error: 'Failed to update usage count after generation.' });
        return;
      }
    } else {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/usage_daily`, {
        method: 'POST',
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: userId, usage_date: today, count: 1 })
      });
      if (!insertRes.ok) {
        res.status(500).json({ error: 'Failed to initialize usage count after generation.' });
        return;
      }
    }

    const remaining = Math.max(0, limit - (currentCount + 1));

    res.status(200).json({ text: text || 'Something went wrong. Please try again.', remaining });
  } catch (error) {
    res.status(500).json({
      error: 'Server error while calling Hugging Face.',
      details: String(error)
    });
  }
}
