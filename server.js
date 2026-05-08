require('dotenv').config();

const express   = require('express');
const axios     = require('axios');
const Stripe    = require('stripe');
const crypto    = require('crypto');
const db        = require('./db');
const { assignPaidRole, removePaidRole, handlePlanChange, syncAllMembers, startBot } = require('./bot');
const { sendMembershipStarted, sendMembershipEnded } = require('./email');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_URL      = process.env.BOT_BASE_URL;
const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI  = `${BASE_URL}/callback`;

const PLAN_PRICES = {
  '5K to 50K Challenge': {
    monthly: process.env.STRIPE_PRICE_5K_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_5K_YEARLY,
  },
  'MarketWave Plus': {
    monthly: process.env.STRIPE_PRICE_PLUS_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_PLUS_YEARLY,
  },
  'MarketWave Elite': {
    monthly: process.env.STRIPE_PRICE_ELITE_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_ELITE_YEARLY,
  },
};

// ══════════════════════════════════════════════════════════
// LIVE STOCK TICKER — Finnhub API
// ══════════════════════════════════════════════════════════
app.get('/api/ticker', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30');

  const SYMBOLS = ['SPY','QQQ','IWM','NVDA','TSLA','META','MSFT','AAPL','GOOGL','AMD','MU','PLTR','HOOD','COIN','MSTR'];
  const token   = process.env.FINNHUB_API_KEY;

  if (!token) return res.status(500).json({ success: false, error: 'Missing API key' });

  try {
    const results = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          const r = await axios.get(
            `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`,
            { timeout: 8000 }
          );
          const d = r.data;
          return {
            symbol,
            price:  d.c  || d.pc || 0,
            change: d.d  || 0,
            pct:    d.dp || 0,
          };
        } catch {
          return { symbol, price: 0, change: 0, pct: 0 };
        }
      })
    );
    return res.json({ success: true, quotes: results.filter(r => r.price > 0) });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Unable to fetch prices' });
  }
});

// ══════════════════════════════════════════════════════════
// DISCORD OAUTH — Step 1: Redirect to Discord login
// ══════════════════════════════════════════════════════════
app.get('/login', (req, res) => {
  const { plan, interval } = req.query;
  if (!plan) return res.status(400).send('Missing plan parameter');

  const stateKey = crypto.randomBytes(16).toString('hex');
  db.saveOAuthState(stateKey, { plan, interval: interval || 'monthly' });

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'identify email',
    state:         stateKey,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ══════════════════════════════════════════════════════════
// DISCORD OAUTH — Step 2: Callback → Stripe checkout
// ══════════════════════════════════════════════════════════
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.send('<h2>Authorization cancelled. <a href="https://www.marketwavetrading.com">Go back</a></h2>');

  const saved = db.getOAuthState(state);
  if (!saved) return res.status(400).send('Invalid or expired session. Please try again.');
  db.deleteOAuthState(state);

  const { plan, interval } = saved;

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const discordUser = userRes.data;

    const priceId = PLAN_PRICES[plan]?.[interval];
    if (!priceId) return res.status(400).send('Plan not found. Contact support.');

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
        discord_email:    discordUser.email || '',
        plan,
        interval,
      },
      subscription_data: {
        metadata: {
          discord_id:       discordUser.id,
          discord_username: discordUser.username,
          plan,
          interval,
        },
      },
      customer_email: discordUser.email || undefined,
      success_url:    `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:     'https://www.marketwavetrading.com/#pricing',
      custom_text: {
        submit: {
          message: '⚠️ No refunds once processed. By completing this purchase you accept our no-refund policy.'
        }
      },
    });

    db.saveMember({
      stripeCustomerId: `pending_${discordUser.id}`,
      discordId:        discordUser.id,
      discordUsername:  discordUser.username,
      email:            discordUser.email || '',
      name:             discordUser.global_name || discordUser.username,
      plan, interval,
      status: 'pending',
    });

    res.redirect(session.url);
  } catch (err) {
    console.error('OAuth/Stripe error:', err.message);
    res.status(500).send('Something went wrong. Please try again or contact support.');
  }
});

// ══════════════════════════════════════════════════════════
// STRIPE WEBHOOKS
// ══════════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📨 Stripe event: ${event.type}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const meta      = session.metadata || {};
        const discordId = meta.discord_id;
        const plan      = meta.plan;
        const interval  = meta.interval || 'monthly';
        const custId    = session.customer;
        if (!discordId || !plan) break;

        const customer = await stripe.customers.retrieve(custId);
        const name     = customer.name  || meta.discord_username || '';
        const email    = customer.email || meta.discord_email    || '';

        // Save Discord ID to Stripe — backup for any future lookups
        await stripe.customers.update(custId, {
          metadata: { discord_id: discordId, discord_username: meta.discord_username || '', plan }
        });

        db.saveMember({ stripeCustomerId: custId, discordId, discordUsername: meta.discord_username || '', email, name, phone: customer.phone || '', plan, interval, status: 'active' });
        await assignPaidRole(discordId, plan);
        await sendMembershipStarted({ name, email, phone: customer.phone || '', discordId, discordUsername: meta.discord_username || '', plan, interval, stripeCustomerId: custId });
        console.log(`✅ New member: ${name} → ${plan}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_create') break;

        const custId = invoice.customer;
        let record   = db.getByStripeId(custId);

        if (!record?.discordId) {
          try {
            const customer  = await stripe.customers.retrieve(custId);
            const discordId = customer.metadata?.discord_id;
            if (!discordId) break;
            const subs    = await stripe.subscriptions.list({ customer: custId, status: 'active', limit: 1 });
            const priceId = subs.data[0]?.items?.data?.[0]?.price?.id;
            const plan    = Object.entries(PLAN_PRICES).find(([, i]) => Object.values(i).includes(priceId))?.[0] || customer.metadata?.plan || '';
            record = db.saveMember({ stripeCustomerId: custId, discordId, discordUsername: customer.metadata?.discord_username || '', email: customer.email || '', name: customer.name || '', plan, status: 'active' });
          } catch { break; }
        }

        if (!record?.discordId) break;
        await assignPaidRole(record.discordId, record.plan);
        db.updateStatus(custId, 'active', null);
        console.log(`🔄 Renewal: ${record.name || record.discordId} → ${record.plan}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const record  = db.getByStripeId(invoice.customer);
        console.log(`⚠️  Payment failed for ${record?.name || invoice.customer} — Stripe will retry`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const custId = sub.customer;
        let record   = db.getByStripeId(custId);

        if (!record?.discordId) {
          try {
            const customer  = await stripe.customers.retrieve(custId);
            const discordId = customer.metadata?.discord_id;
            if (!discordId) { console.warn(`❌ No Discord ID for ${custId}`); break; }
            const plan = sub.metadata?.plan || customer.metadata?.plan || '';
            record = db.saveMember({ stripeCustomerId: custId, discordId, discordUsername: customer.metadata?.discord_username || '', email: customer.email || '', name: customer.name || '', plan, status: 'cancelled' });
          } catch (e) { console.error(`Could not retrieve customer ${custId}:`, e.message); break; }
        }

        await removePaidRole(record.discordId);
        db.updateStatus(custId, 'cancelled', new Date().toISOString());
        await sendMembershipEnded({ name: record.name, email: record.email, discordId: record.discordId, discordUsername: record.discordUsername, plan: record.plan, reason: sub.cancellation_details?.reason || 'cancelled', stripeCustomerId: custId });
        console.log(`❌ Ended: ${record.name || record.discordId} → Free only`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub     = event.data.object;
        const custId  = sub.customer;
        const record  = db.getByStripeId(custId);
        if (!record?.discordId) break;
        const newPriceId = sub.items?.data?.[0]?.price?.id;
        if (!newPriceId) break;
        const newPlan = Object.entries(PLAN_PRICES).find(([, i]) => Object.values(i).includes(newPriceId))?.[0];
        if (newPlan && newPlan !== record.plan) {
          await handlePlanChange(record.discordId, newPlan);
          db.saveMember({ ...record, plan: newPlan });
          console.log(`🔄 Plan change: ${record.name} → ${newPlan}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler error (${event.type}):`, err.message);
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════
// SUCCESS PAGE
// ══════════════════════════════════════════════════════════
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Welcome to MarketWave!</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#04080f;color:#d6eaf8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;padding:48px 40px;max-width:520px}.icon{font-size:72px;margin-bottom:24px}h1{font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#fff;margin-bottom:16px}p{font-size:16px;color:#6a9bb5;line-height:1.7;margin-bottom:24px}.hi{color:#00c8f0;font-weight:700}a.btn{display:inline-block;background:#5865F2;color:#fff;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;text-decoration:none;margin:8px}a.btn.cy{background:#00c8f0;color:#04080f}</style>
</head><body><div class="box">
<div class="icon">🎉</div>
<h1>Welcome to the Wave!</h1>
<p>Your membership is <span class="hi">now active</span>.<br>Your Discord roles have been assigned automatically.<br>Head to the server and start riding the market!</p>
<a class="btn" href="https://discord.gg/vPXks54y3N">Open Discord →</a>
<a class="btn cy" href="https://www.marketwavetrading.com">Back to Site</a>
</div></body></html>`);
});

// ══════════════════════════════════════════════════════════
// ADMIN SYNC
// ══════════════════════════════════════════════════════════
app.get('/admin/sync', async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await syncAllMembers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ══════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MarketWave server running on port ${PORT}`));

startBot();

const { scheduleDailyReport } = require('./daily-report');
scheduleDailyReport();
