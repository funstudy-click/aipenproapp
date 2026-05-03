export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.HUGGINGFACE_API_TOKEN || process.env.HUGGINGFACE_API_TOKEN_HERE;
  if (!apiKey) {
    res.status(500).json({
      error: 'Missing HUGGINGFACE_API_TOKEN (or HUGGINGFACE_API_TOKEN_HERE) server environment variable.'
    });
    return;
  }

  const { system, user } = req.body || {};
  if (!system || !user) {
    res.status(400).json({ error: 'Missing system or user prompt.' });
    return;
  }

  const model = 'mistralai/Mistral-7B-Instruct-v0.1';
  const prompt = `${system}\n\n${user}`;

  try {
    const hfRes = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
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

    const data = await hfRes.json();

    if (!hfRes.ok) {
      res.status(hfRes.status).json({
        error: data?.error || 'Hugging Face API request failed.',
        details: data
      });
      return;
    }

    const fullText = data?.[0]?.generated_text || '';
    const text = fullText.replace(prompt, '').trim();

    res.status(200).json({ text: text || 'Something went wrong. Please try again.' });
  } catch (error) {
    res.status(500).json({
      error: 'Server error while calling Hugging Face.',
      details: String(error)
    });
  }
}
