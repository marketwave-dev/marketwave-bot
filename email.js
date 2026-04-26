/**
 * email.js — Email alerts via Gmail
 *
 * Sends notifications to marketwave.trading@gmail.com when:
 *   • A paid membership starts
 *   • A paid membership ends (cancelled / expired)
 *   • A payment fails
 *
 * Uses Gmail App Password — NOT your regular Gmail password.
 * Setup: Google Account → Security → 2-Step Verification → App Passwords
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

// ── Generic send ──────────────────────────────────────────
async function sendEmail({ subject, html }) {
  try {
    await transporter.sendMail({
      from: `"MarketWave Bot" <${process.env.EMAIL_FROM}>`,
      to:   process.env.EMAIL_NOTIFY,
      subject,
      html,
    });
    console.log(`📧 Email sent: ${subject}`);
  } catch (err) {
    console.error('❌ Email failed:', err.message);
  }
}

// ── Membership STARTED ────────────────────────────────────
async function sendMembershipStarted({ name, email, phone, discordId, discordUsername, plan, interval, stripeCustomerId }) {
  const planLabel    = plan || 'Unknown';
  const intervalLbl  = interval === 'yearly' ? 'Yearly' : 'Monthly';
  const priceMap     = {
    '5K to 50K Challenge': { monthly: '$49', yearly: '$530' },
    'MarketWave Plus':     { monthly: '$69', yearly: '$745' },
    'MarketWave Elite':    { monthly: '$99', yearly: '$1,070' },
  };
  const price = priceMap[plan]?.[interval] || '';

  await sendEmail({
    subject: `🎉 New Paid Member — ${planLabel} (${intervalLbl})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#04080f;color:#d6eaf8;padding:32px;border-radius:12px;">
        <div style="background:#00c8f0;padding:16px 24px;border-radius:8px;margin-bottom:24px;">
          <h1 style="margin:0;font-size:24px;color:#04080f;font-weight:900;letter-spacing:1px;">
            🎉 NEW PAID MEMBER
          </h1>
        </div>

        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;width:160px;">Name</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;font-weight:600;">${name || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Email</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${email || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Phone</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${phone || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Discord ID</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${discordId || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Discord Username</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${discordUsername || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Plan</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#00c8f0;font-weight:700;">${planLabel}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Billing</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${intervalLbl} — ${price}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Stripe ID</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;font-size:12px;color:#6a9bb5;">${stripeCustomerId || '—'}</td></tr>
          <tr><td style="padding:10px 0;color:#6a9bb5;">Date</td>
              <td style="padding:10px 0;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</td></tr>
        </table>

        <div style="margin-top:24px;padding:16px;background:#0b1a2c;border-radius:8px;font-size:13px;color:#6a9bb5;">
          Discord role has been automatically assigned. No action needed.
        </div>
      </div>
    `,
  });
}

// ── Membership ENDED ──────────────────────────────────────
async function sendMembershipEnded({ name, email, discordId, discordUsername, plan, reason, stripeCustomerId }) {
  const reasonMap = {
    cancelled:       'Member cancelled',
    payment_failed:  'Payment failed',
    expired:         'Subscription expired',
  };

  await sendEmail({
    subject: `❌ Membership Ended — ${plan || 'Unknown'} (${reasonMap[reason] || reason})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#04080f;color:#d6eaf8;padding:32px;border-radius:12px;">
        <div style="background:#ff4560;padding:16px 24px;border-radius:8px;margin-bottom:24px;">
          <h1 style="margin:0;font-size:24px;color:#fff;font-weight:900;letter-spacing:1px;">
            ❌ MEMBERSHIP ENDED
          </h1>
        </div>

        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;width:160px;">Name</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;font-weight:600;">${name || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Email</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${email || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Discord ID</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${discordId || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Discord Username</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;">${discordUsername || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Plan</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#ff4560;font-weight:700;">${plan || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Reason</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#ff4560;">${reasonMap[reason] || reason}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Stripe ID</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;font-size:12px;color:#6a9bb5;">${stripeCustomerId || '—'}</td></tr>
          <tr><td style="padding:10px 0;color:#6a9bb5;">Date</td>
              <td style="padding:10px 0;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</td></tr>
        </table>

        <div style="margin-top:24px;padding:16px;background:#0b1a2c;border-radius:8px;font-size:13px;color:#6a9bb5;">
          Paid Discord role has been automatically removed. Member retains Free Community access.
        </div>
      </div>
    `,
  });
}

module.exports = { sendMembershipStarted, sendMembershipEnded };
