# AIPenPro 🖊️

AI-powered writing assistant for professionals. Generate emails, proposals, reports, social posts, and more in seconds.

## Files

- `index.html` — Landing page (hero, features, pricing, testimonials)
- `app.html` — The writing app with free/paid tier logic
- `vercel.json` — Vercel deployment config

## Free / Pro Tier Logic

- **Free**: 5 generations per day (tracked in localStorage, resets daily)
- **Pro**: Unlimited (stored as a flag in localStorage — connect to Stripe for real payments)
- When limit is hit, an upgrade modal appears automatically

## How to Deploy on Vercel

### Option A — Vercel Dashboard (easiest, no coding needed)

1. Go to https://vercel.com and log in to your account
2. Click **"Add New Project"**
3. Click **"Upload"** (you'll see an option to drag and drop files)
4. Drag the entire `aipenproapp` folder into the upload area
5. Click **Deploy**
6. Done! Vercel gives you a live URL like `https://aipenproapp.vercel.app`

### Option B — Vercel CLI (faster for updates)

```bash
npm install -g vercel
cd aipenproapp
vercel
```

Follow the prompts. Your site will be live in ~30 seconds.

### Option C — GitHub + Vercel (best for ongoing updates)

1. Push this folder to a GitHub repo
2. In Vercel, click "Import Git Repository"
3. Select your repo — Vercel auto-deploys on every push

## Adding a Custom Domain

1. In your Vercel project, go to Settings → Domains
2. Add your domain (e.g. `aipenproapp.com`)
3. Update your DNS as instructed

## Adding Real Payments (Stripe)

To actually charge users for Pro:
1. Create a Stripe account at https://stripe.com
2. Create a product + price (£9/month)
3. Use Stripe Checkout or Payment Links — drop the link into the upgrade button in `app.html`
4. After payment, redirect to `app.html?plan=pro` (this sets the Pro flag)

For production, move plan verification server-side (Vercel Functions or a backend).

## Customisation

- **Your API Key**: The app calls the Anthropic API directly. For production, proxy this through a Vercel Function (`/api/generate.js`) to keep your key private.
- **Branding**: Change colours in the `:root` CSS variables at the top of each file
- **Pricing**: Update prices in `index.html` under the `#pricing` section

## Tech Stack

- Pure HTML / CSS / JS — no build step, no frameworks
- Anthropic Claude API (claude-sonnet-4-20250514)
- Vercel for hosting (free tier works perfectly)
