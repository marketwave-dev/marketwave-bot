/**
 * db.js — Simple JSON file database
 * Stores Discord ID ↔ Stripe customer ID mapping + member records
 * Can be swapped for a real DB later without changing anything else
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'members.json');

// Initialize DB file if it doesn't exist
function init() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ members: {}, discordToStripe: {} }, null, 2));
  }
}

function read() {
  init();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── Save / update a member record ──────────────────────────
function saveMember({ stripeCustomerId, discordId, discordUsername, email, name, phone, plan, interval, status }) {
  const db = read();
  db.members[stripeCustomerId] = {
    stripeCustomerId,
    discordId,
    discordUsername: discordUsername || '',
    email:           email           || '',
    name:            name            || '',
    phone:           phone           || '',
    plan:            plan            || '',
    interval:        interval        || 'monthly',
    status:          status          || 'active',
    updatedAt:       new Date().toISOString(),
    createdAt:       db.members[stripeCustomerId]?.createdAt || new Date().toISOString(),
  };
  // Also maintain reverse lookup
  if (discordId) db.discordToStripe[discordId] = stripeCustomerId;
  write(db);
  return db.members[stripeCustomerId];
}

// ── Look up member by Stripe customer ID ──────────────────
function getByStripeId(stripeCustomerId) {
  return read().members[stripeCustomerId] || null;
}

// ── Look up member by Discord ID ──────────────────────────
function getByDiscordId(discordId) {
  const db  = read();
  const cid = db.discordToStripe[discordId];
  return cid ? db.members[cid] : null;
}

// ── Update member status ───────────────────────────────────
function updateStatus(stripeCustomerId, status, endDate) {
  const db = read();
  if (db.members[stripeCustomerId]) {
    db.members[stripeCustomerId].status    = status;
    db.members[stripeCustomerId].endDate   = endDate || null;
    db.members[stripeCustomerId].updatedAt = new Date().toISOString();
    write(db);
  }
}

// ── Save OAuth state (Discord ID + plan before payment) ───
function saveOAuthState(stateKey, payload) {
  const db = read();
  db.oauthStates = db.oauthStates || {};
  db.oauthStates[stateKey] = { ...payload, createdAt: Date.now() };
  write(db);
}

function getOAuthState(stateKey) {
  const db = read();
  return db.oauthStates?.[stateKey] || null;
}

function deleteOAuthState(stateKey) {
  const db = read();
  if (db.oauthStates?.[stateKey]) {
    delete db.oauthStates[stateKey];
    write(db);
  }
}

// ── Get all active members (for auditing) ─────────────────
function getAllMembers() {
  return Object.values(read().members);
}

module.exports = {
  saveMember, getByStripeId, getByDiscordId, updateStatus,
  saveOAuthState, getOAuthState, deleteOAuthState, getAllMembers,
};
