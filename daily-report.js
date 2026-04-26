/**
 * daily-report.js — Daily Excel Report
 *
 * Sends an Excel file every day at 8:00 AM ET to marketwave.trading@gmail.com
 * showing ALL members (free + paid) with their details and roles.
 *
 * Columns:
 * Name, Email, Phone, Discord ID, Discord Username, Plan, Billing, Status, Join Date, Last Updated
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const ExcelJS    = require('exceljs');
const db         = require('./db');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

// ── Build Excel file in memory ────────────────────────────
async function buildExcel(members) {
  const workbook  = new ExcelJS.Workbook();
  const sheet     = workbook.addWorksheet('MarketWave Members');

  // Column definitions
  sheet.columns = [
    { header: 'Name',             key: 'name',            width: 22 },
    { header: 'Email',            key: 'email',           width: 28 },
    { header: 'Phone',            key: 'phone',           width: 16 },
    { header: 'Discord ID',       key: 'discordId',       width: 22 },
    { header: 'Discord Username', key: 'discordUsername', width: 22 },
    { header: 'Plan',             key: 'plan',            width: 26 },
    { header: 'Billing',          key: 'interval',        width: 12 },
    { header: 'Status',           key: 'status',          width: 12 },
    { header: 'Stripe ID',        key: 'stripeCustomerId',width: 22 },
    { header: 'Join Date',        key: 'createdAt',       width: 20 },
    { header: 'Last Updated',     key: 'updatedAt',       width: 20 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF00C8F0' }, // cyan
    };
    cell.font   = { bold: true, color: { argb: 'FF04080F' }, size: 11 };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 22;

  // Sort: active first, then by plan name
  const sorted = [...members].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (a.plan || '').localeCompare(b.plan || '');
  });

  // Add data rows
  sorted.forEach((m, i) => {
    const row = sheet.addRow({
      name:             m.name             || '—',
      email:            m.email            || '—',
      phone:            m.phone            || '—',
      discordId:        m.discordId        || '—',
      discordUsername:  m.discordUsername  || '—',
      plan:             m.plan             || 'Free',
      interval:         m.interval         || '—',
      status:           m.status           || '—',
      stripeCustomerId: m.stripeCustomerId || '—',
      createdAt:        m.createdAt ? new Date(m.createdAt).toLocaleDateString('en-US') : '—',
      updatedAt:        m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-US') : '—',
    });

    // Alternate row colors
    const bgColor = i % 2 === 0 ? 'FF07111E' : 'FF0B1A2C';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.font = { color: { argb: 'FFD6EAF8' }, size: 10 };
      cell.alignment = { vertical: 'middle' };
    });

    // Color status cell
    const statusCell = row.getCell('status');
    if (m.status === 'active') {
      statusCell.font = { color: { argb: 'FF00E676' }, bold: true, size: 10 };
    } else if (m.status === 'cancelled') {
      statusCell.font = { color: { argb: 'FFFF4560' }, bold: true, size: 10 };
    }

    row.height = 18;
  });

  // Summary rows at bottom
  sheet.addRow([]);
  const totalRow = sheet.addRow(['', '', '', '', '', '', '', '', '', 'Total Members:', members.length]);
  const activeCount = members.filter(m => m.status === 'active').length;
  const cancelCount = members.filter(m => m.status === 'cancelled').length;
  sheet.addRow(['', '', '', '', '', '', '', '', '', 'Active:', activeCount]);
  sheet.addRow(['', '', '', '', '', '', '', '', '', 'Cancelled:', cancelCount]);

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ── Send the daily report ─────────────────────────────────
async function sendDailyReport() {
  try {
    const members = db.getAllMembers();
    const today   = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const activeCount = members.filter(m => m.status === 'active').length;
    const buffer      = await buildExcel(members);
    const filename    = `MarketWave-Members-${new Date().toISOString().split('T')[0]}.xlsx`;

    await transporter.sendMail({
      from:    `"MarketWave Bot" <${process.env.EMAIL_FROM}>`,
      to:      process.env.EMAIL_NOTIFY,
      subject: `📊 Daily Member Report — ${today}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;background:#04080f;color:#d6eaf8;padding:28px;border-radius:12px;">
          <div style="background:#00c8f0;padding:14px 20px;border-radius:8px;margin-bottom:20px;">
            <h2 style="margin:0;color:#04080f;font-size:20px;font-weight:900;">📊 DAILY MEMBER REPORT</h2>
          </div>
          <p style="font-size:15px;">${today}</p>
          <table style="width:100%;margin-top:16px;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Total Members</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;font-weight:700;">${members.length}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#6a9bb5;">Active Paid</td>
              <td style="padding:10px 0;border-bottom:1px solid #1a3550;color:#00e676;font-weight:700;">${activeCount}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#6a9bb5;">Cancelled</td>
              <td style="padding:10px 0;color:#ff4560;font-weight:700;">${members.length - activeCount}</td>
            </tr>
          </table>
          <p style="margin-top:20px;font-size:13px;color:#6a9bb5;">Full member list attached as Excel file.</p>
        </div>
      `,
      attachments: [{
        filename,
        content: buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });

    console.log(`📊 Daily report sent — ${members.length} members, ${activeCount} active`);
  } catch (err) {
    console.error('❌ Daily report failed:', err.message);
  }
}

// ── Scheduler — runs at 8:00 AM ET every day ─────────────
function scheduleDailyReport() {
  function msUntil8amET() {
    const now = new Date();
    const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const next = new Date(et);
    next.setHours(8, 0, 0, 0);
    if (et >= next) next.setDate(next.getDate() + 1); // already past 8am, schedule tomorrow
    const diff = next - et;
    return diff;
  }

  function scheduleNext() {
    const ms = msUntil8amET();
    const hrs = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    console.log(`⏰ Daily report scheduled in ${hrs}h ${min}m`);
    setTimeout(async () => {
      await sendDailyReport();
      scheduleNext(); // reschedule for next day
    }, ms);
  }

  scheduleNext();
}

module.exports = { sendDailyReport, scheduleDailyReport };
