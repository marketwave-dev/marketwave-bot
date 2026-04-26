# MarketWave Bot — Setup Guide

## What This Bot Does

| Event | What Happens |
|---|---|
| User joins Discord server | Bot auto-assigns **Free Member** role |
| User pays for any plan | Bot assigns **Free** + **Paid** role instantly |
| Subscription renews | Bot confirms roles are still active |
| Subscription cancelled/expired | Bot removes paid role, keeps Free role |
| New paid member | Email sent to marketwave.trading@gmail.com |
| Membership ends | Email sent to marketwave.trading@gmail.com |
| Plan upgrade/downgrade | Bot swaps roles automatically |

---

## Step 1 — Create a Discord Bot

1. Go to **https://discord.dev/applications**
2. Click **New Application** → name it "MarketWave Bot"
3. Click **Bot** in the left sidebar
4. Click **Reset Token** → copy the token → paste into `.env` as `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**, turn ON:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Click **OAuth2 → General** in sidebar
   - Copy **Client ID** → paste as `DISCORD_CLIENT_ID`
   - Copy **Client Secret** → paste as `DISCORD_CLIENT_SECRET`
7. Click **OAuth2 → URL Generator**:
   - Scopes: ✅ `bot`, ✅ `applications.commands`
   - Bot Permissions: ✅ Manage Roles, ✅ View Channels, ✅ Send Messages
   - Copy the generated URL and open it to invite the bot to your server

> ⚠️ The bot's role in Discord must be ABOVE all member roles it needs to assign.
> Go to Server Settings → Roles → drag "MarketWave Bot" role to the top.

---

## Step 2 — Get Discord Role IDs

Your 4 roles and what gets assigned:

| Membership | Discord Roles Assigned |
|---|---|
| Free Members | `Members` |
| 5K to 50K Challenge | `Members` + `Member_5k` |
| Member Plus | `Members` + `Member_Plus` |
| Elite Members | `Members` + `Member_Elite` |

> When a paid subscription ends → paid role removed, `Members` role stays.

**How to get Role IDs:**
1. In Discord: **Settings → Advanced → Enable Developer Mode**
2. Your server → **Server Settings → Roles**
3. Right-click each role → **Copy Role ID** → paste into `.env`

```env
ROLE_FREE=    ← right-click "Members"      → Copy Role ID
ROLE_5K=      ← right-click "Member_5k"   → Copy Role ID
ROLE_PLUS=    ← right-click "Member_Plus"  → Copy Role ID
ROLE_ELITE=   ← right-click "Member_Elite" → Copy Role ID
```

> ⚠️ The bot's role must be ABOVE all 4 of these roles in the role list.
> Server Settings → Roles → drag "MarketWave Bot" above Members, Member_5k, Member_Plus, Member_Elite.

---

## Step 3 — Set Up Stripe

1. Go to **Stripe Dashboard → Developers → API Keys**
   - Copy **Secret key** → paste as `STRIPE_SECRET_KEY`

2. Create your products in Stripe (if not already done):
   - Dashboard → Products → Add Product for each plan
   - Add Monthly and Yearly prices for each
   - Copy each **Price ID** (starts with `price_`) → paste into `.env`

3. Set up Stripe Webhook:
   - Dashboard → Developers → Webhooks → Add Endpoint
   - URL: `https://marketwavebot-f0tu.onrender.com/webhook`
   - Events to listen for:
     - ✅ `checkout.session.completed`
     - ✅ `customer.subscription.deleted`
     - ✅ `customer.subscription.updated`
     - ✅ `invoice.payment_succeeded`
     - ✅ `invoice.payment_failed`
   - Copy **Signing Secret** → paste as `STRIPE_WEBHOOK_SECRET`

---

## Step 4 — Gmail App Password

1. Go to your Google Account → **Security**
2. Enable **2-Step Verification** (required)
3. Search for **App Passwords** → Create one for "Mail"
4. Copy the 16-character password → paste as `EMAIL_PASS` in `.env`

---

## Step 5 — Deploy to Render.com

1. Push this folder to a **private GitHub repo**
2. Go to **render.com** → New → Web Service → connect your GitHub repo
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
4. Add all your `.env` values in the **Environment Variables** section on Render
5. Deploy — your URL will be `https://marketwavebot-f0tu.onrender.com`

---

## Step 6 — Sync Existing Members (One-Time)

After deployment, run this URL **once** to sync all existing paid subscribers:

```
https://marketwavebot-f0tu.onrender.com/admin/sync?key=YOUR_ADMIN_KEY
```

Add `ADMIN_KEY=some_random_secret_string` to your `.env` first.

---

## File Structure

```
marketwave-bot/
├── server.js       Main server — OAuth, Stripe webhooks, routes
├── bot.js          Discord bot — role management
├── db.js           JSON file database — member records
├── roles.js        Role ID mapping — plan name → Discord role ID
├── email.js        Email alerts — membership start/end
├── package.json    Dependencies
├── .env.example    Environment variable template
└── members.json    Auto-created — stores member data (do not delete)
```

---

## Testing

Test the full flow locally:
```bash
npm install
cp .env.example .env
# Fill in .env values
node server.js
```

Use Stripe CLI to test webhooks locally:
```bash
stripe listen --forward-to localhost:3000/webhook
```

---

## Support

Email: marketwave.trading@gmail.com
