/**
 * roles.js — Plan → Discord Role mapping
 *
 * EXACT Discord role names on your server:
 *
 *   Free Members        → Members
 *   Elite Members       → Members  +  Member_Elite
 *   Member Plus         → Members  +  Member_Plus
 *   5K to 50K Challenge → Members  +  Member_5k
 *
 * Everyone always gets "Members".
 * Paid members get "Members" + their specific paid role.
 * On cancellation: paid role removed, "Members" stays.
 *
 * HOW TO GET ROLE IDs:
 * 1. Enable Developer Mode: Discord Settings → Advanced → Developer Mode
 * 2. Server Settings → Roles → right-click any role → Copy Role ID
 * 3. Paste into .env file
 */

require('dotenv').config();

// ── Role ID map (IDs come from .env) ──────────────────────
const ROLES = {
  // "Members" — the base free role EVERYONE gets
  free:  process.env.ROLE_FREE,    // Discord role name: Members

  // Paid roles — assigned ON TOP of the free role
  '5k':  process.env.ROLE_5K,     // Discord role name: Member_5k
  plus:  process.env.ROLE_PLUS,   // Discord role name: Member_Plus
  elite: process.env.ROLE_ELITE,  // Discord role name: Member_Elite
};

// ── Stripe plan name → role key ───────────────────────────
const PLAN_TO_KEY = {
  '5K to 50K Challenge': '5k',
  'MarketWave Plus':     'plus',
  'MarketWave Elite':    'elite',
};

/**
 * Get the Discord role ID for a given Stripe plan name
 * @param {string} planName — e.g. "MarketWave Elite"
 * @returns {string|null} Discord role ID
 */
function getRoleId(planName) {
  const key = PLAN_TO_KEY[planName];
  return key ? ROLES[key] : null;
}

/** Get the base free role ID ("Members") */
function getFreeRoleId() {
  return ROLES.free;
}

/** Get all paid role IDs — used when removing paid access */
function getAllPaidRoleIds() {
  return [ROLES['5k'], ROLES.plus, ROLES.elite].filter(Boolean);
}

/** Log a warning if any role IDs are missing from .env */
function validateRoles() {
  const labels = {
    free:  'ROLE_FREE  (Members)',
    '5k':  'ROLE_5K   (Member_5k)',
    plus:  'ROLE_PLUS  (Member_Plus)',
    elite: 'ROLE_ELITE (Member_Elite)',
  };
  const missing = Object.entries(ROLES)
    .filter(([, id]) => !id)
    .map(([key]) => labels[key] || key);

  if (missing.length > 0) {
    console.warn(`⚠️  Missing role IDs in .env:\n   ${missing.join('\n   ')}`);
  } else {
    console.log('✅ All 4 Discord role IDs loaded from .env');
  }
}

module.exports = { ROLES, PLAN_TO_KEY, getRoleId, getFreeRoleId, getAllPaidRoleIds, validateRoles };
