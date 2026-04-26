/**
 * server.js — MarketWave Bot Server
 *
 * Routes:
 *   GET  /login              → starts Discord OAuth (linked from pricing buttons)
 *   GET  /callback           → Discord OAuth callback → redirect to Stripe checkout
 *   POST /webhook            → Stripe webhook handler (subscription events)
 *   GET  /admin/sync         → sync all DB members' Discord roles (run once for existing members)
 *   GET  /health             → health check for Render.com
 */

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

// ── Stripe webhook needs raw body — MUST be before express.json() ──
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_URL      = process.env.BOT_BASE_URL;
const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI  = `${BASE_URL}/callback`;

// ── Plan name → Stripe Price ID map ───────────────────────
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
// STEP 1 — User clicks plan button → Discord OAuth
// URL format: /login?plan=MarketWave+Elite&interval=monthly
// ══════════════════════════════════════════════════════════
app.get('/login', (req, res) => {
  const { plan, interval } = req.query;

  if (!plan) {
    return res.status(400).send('Missing plan parameter');
  }

  // Generate random state key — prevents CSRF
  const stateKey = crypto.randomBytes(16).toString('hex');

  // Save plan + interval to DB so we retrieve it after OAuth
  db.saveOAuthState(stateKey, { plan, interval: interval || 'monthly' });

  // Redirect to Discord OAuth
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
// STEP 2 — Discord returns user here → create Stripe session
// ══════════════════════════════════════════════════════════
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.send('<h2>Authorization cancelled. <a href="/">Go back</a></h2>');
  }

  // Retrieve saved plan from state
  const saved = db.getOAuthState(state);
  if (!saved) {
    return res.status(400).send('Invalid or expired session. Please try again from the website.');
  }
  db.deleteOAuthState(state);

  const { plan, interval } = saved;

  try {
    // Exchange code for Discord access token
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

    const accessToken = tokenRes.data.access_token;

    // Get Discord user info
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const discordUser = userRes.data;
    // discordUser.id       = Discord user ID
    // discordUser.username = Discord username
    // discordUser.email    = email (if scope includes email)

    // Look up Stripe Price ID for this plan
    const priceId = PLAN_PRICES[plan]?.[interval];
    if (!priceId) {
      console.error(`❌ No price ID for plan: ${plan} / ${interval}`);
      return res.status(400).send('Plan configuration error. Please contact support.');
    }

    // Create Stripe checkout session
    // Discord info stored in metadata — retrieved when webhook fires
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
      // No-refund policy shown at checkout
      custom_text: {
        submit: {
          message: '⚠️ No refunds once processed. By completing this purchase you accept our no-refund policy.'
        }
      },
    });

    // Pre-save the member record (will be completed by webhook)
    db.saveMember({
      stripeCustomerId: session.customer || `pending_${discordUser.id}`,
      discordId:        discordUser.id,
      discordUsername:  discordUser.username,
      email:            discordUser.email || '',
      name:             discordUser.global_name || discordUser.username,
      plan,
      interval,
      status:           'pending',
    });

    // Redirect to Stripe checkout
    res.redirect(session.url);

  } catch (err) {
    console.error('❌ OAuth/Stripe error:', err.message);
    res.status(500).send('Something went wrong. Please try again or contact support.');
  }
});

// ══════════════════════════════════════════════════════════
// STRIPE WEBHOOKS
// ══════════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  // Verify webhook signature — prevents spoofed events
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📨 Stripe event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Payment succeeded / subscription activated ────────
      case 'checkout.session.completed': {
        const session  = event.data.object;
        if (session.mode !== 'subscription') break;

        const meta       = session.metadata || {};
        const discordId  = meta.discord_id;
        const plan       = meta.plan;
        const interval   = meta.interval || 'monthly';
        const custId     = session.customer;

        if (!discordId || !plan) {
          console.warn('⚠️  Missing discord_id or plan in session metadata');
          break;
        }

        // Retrieve full customer info from Stripe
        const customer = await stripe.customers.retrieve(custId);
        const name     = customer.name || meta.discord_username || '';
        const email    = customer.email || meta.discord_email || '';

        // Save/update member record
        db.saveMember({
          stripeCustomerId: custId,
          discordId,
          discordUsername:  meta.discord_username || '',
          email,
          name,
          phone:            customer.phone || '',
          plan,
          interval,
          status:           'active',
        });

        // Assign Discord roles
        await assignPaidRole(discordId, plan);

        // Send email notification
        await sendMembershipStarted({
          name, email,
          phone:           customer.phone || '',
          discordId,
          discordUsername: meta.discord_username || '',
          plan, interval,
          stripeCustomerId: custId,
        });

        console.log(`✅ New member activated: ${name} → ${plan}`);
        break;
      }

      // ── Subscription renewal (ensure roles stay active) ──
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_create') break; // handled by checkout.session.completed

        const custId = invoice.customer;
        const record = db.getByStripeId(custId);
        if (!record?.discordId) break;

        // Re-assign roles on renewal (catches any accidental role removal)
        await assignPaidRole(record.discordId, record.plan);
        db.updateStatus(custId, 'active', null);
        console.log(`🔄 Renewal confirmed: ${record.name} → ${record.plan}`);
        break;
      }

      // ── Payment failed ────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const custId  = invoice.customer;
        const record  = db.getByStripeId(custId);
        if (!record?.discordId) break;

        console.log(`⚠️  Payment failed for ${record.name} — Stripe will retry automatically`);
        // Note: We DON'T remove roles on first failure — Stripe retries.
        // Roles are removed only when the subscription is fully cancelled (below).
        break;
      }

      // ── Subscription cancelled / expired ─────────────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const custId = sub.customer;
        const record = db.getByStripeId(custId);

        if (!record?.discordId) {
          console.warn(`⚠️  No record for Stripe customer ${custId}`);
          break;
        }

        // Remove paid roles, keep Free role
        await removePaidRole(record.discordId);

        // Update DB
        db.updateStatus(custId, 'cancelled', new Date().toISOString());

        // Send email notification
        await sendMembershipEnded({
          name:            record.name,
          email:           record.email,
          discordId:       record.discordId,
          discordUsername: record.discordUsername,
          plan:            record.plan,
          reason:          sub.cancellation_details?.reason || 'cancelled',
          stripeCustomerId: custId,
        });

        console.log(`❌ Subscription ended: ${record.name} → downgraded to Free`);
        break;
      }

      // ── Plan upgrade/downgrade ────────────────────────────
      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const custId = sub.customer;
        const record = db.getByStripeId(custId);
        if (!record?.discordId) break;

        // Check if plan changed by looking at the subscription items
        const newPriceId = sub.items?.data?.[0]?.price?.id;
        if (!newPriceId) break;

        // Map price ID back to plan name
        const newPlan = Object.entries(PLAN_PRICES).find(([, intervals]) =>
          Object.values(intervals).includes(newPriceId)
        )?.[0];

        if (newPlan && newPlan !== record.plan) {
          await handlePlanChange(record.discordId, newPlan);
          record.plan = newPlan;
          db.saveMember({ ...record, plan: newPlan });
          console.log(`🔄 Plan changed: ${record.name} → ${newPlan}`);
        }
        break;
      }

      default:
        // Unhandled event type — that's fine
        break;
    }
  } catch (err) {
    console.error(`❌ Webhook handler error (${event.type}):`, err.message);
    // Still return 200 to prevent Stripe from retrying endlessly
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════
// SUCCESS PAGE — shown after payment
// ══════════════════════════════════════════════════════════
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Welcome to MarketWave!</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:#04080f; color:#d6eaf8; font-family:Arial,sans-serif;
               display:flex; align-items:center; justify-content:center; min-height:100vh; }
        .box { text-align:center; padding:48px 40px; max-width:520px; }
        .icon { font-size:72px; margin-bottom:24px; }
        h1 { font-size:36px; font-weight:900; text-transform:uppercase;
             letter-spacing:2px; color:#fff; margin-bottom:16px; }
        p { font-size:16px; color:#6a9bb5; line-height:1.7; margin-bottom:24px; }
        .highlight { color:#00c8f0; font-weight:700; }
        a.btn { display:inline-block; background:#5865F2; color:#fff;
                padding:14px 32px; border-radius:8px; font-weight:700;
                font-size:16px; text-decoration:none; margin:8px; }
        a.btn.cyan { background:#00c8f0; color:#04080f; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="icon">🎉</div>
        <h1>Welcome to the Wave!</h1>
        <p>Your membership is <span class="highlight">now active</span>.<br>
           Your Discord roles have been assigned automatically.<br>
           Head to the server and start riding the market!</p>
        <a class="btn" href="https://discord.gg/vPXks54y3N">Open Discord →</a>
        <a class="btn cyan" href="https://www.marketwavetrading.com">Back to Site</a>
      </div>
    </body>
    </html>
  `);
});

// ══════════════════════════════════════════════════════════
// ADMIN — Sync all existing members (run once)
// Protects with a simple query key from .env
// ══════════════════════════════════════════════════════════
app.get('/admin/sync', async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const result = await syncAllMembers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check for Render.com ───────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MarketWave server running on port ${PORT}`);
});

// Start Discord bot
const { startBot: boot } = require('./bot');
boot();
