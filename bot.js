/**
 * bot.js — MarketWave Discord Bot
 *
 * Handles:
 *   • guildMemberAdd  → automatically assigns Free Member role to anyone who joins
 *   • assignPaidRole  → gives Free + Paid role when subscription starts
 *   • removePaidRole  → removes paid role, keeps Free role when subscription ends
 *   • handleUpgrade   → switches from one paid role to another
 *
 * This bot is required to run alongside server.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getRoleId, getFreeRoleId, getAllPaidRoleIds, validateRoles } = require('./roles');
const db = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember],
});

const GUILD_ID = process.env.DISCORD_GUILD_ID;

// ── Bot ready ─────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Discord bot online: ${client.user.tag}`);
  validateRoles();
});

// ── New member joins server → give Free role + any pending paid role ──
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  try {
    const freeRoleId = getFreeRoleId();
    if (freeRoleId) {
      await member.roles.add(freeRoleId);
      console.log(`✅ Free role → ${member.user.tag} (${member.user.id})`);
    }

    // Check if this member has a paid subscription in DB
    // (handles case where they paid BEFORE joining Discord)
    const record = db.getByDiscordId(member.user.id);
    if (record && record.status === 'active' && record.plan) {
      const { getRoleId } = require('./roles');
      const paidRoleId = getRoleId(record.plan);
      if (paidRoleId) {
        await member.roles.add(paidRoleId);
        console.log(`✅ Paid role auto-assigned on join → ${member.user.tag} → ${record.plan}`);
      }
    }
  } catch (err) {
    console.error(`❌ Failed to assign role to ${member.user.tag}:`, err.message);
  }
});

// ── Fetch a guild member by Discord user ID ───────────────
async function getMember(discordId) {
  try {
    const guild  = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId);
    return member;
  } catch {
    return null;
  }
}

/**
 * Assign Free role + the appropriate Paid role to a member.
 * Called when a subscription payment succeeds.
 *
 * @param {string} discordId  — Discord user ID
 * @param {string} planName   — e.g. "MarketWave Elite"
 */
async function assignPaidRole(discordId, planName) {
  const member = await getMember(discordId);
  if (!member) {
    console.warn(`⚠️  Member ${discordId} not found in server. They may need to join first.`);
    return false;
  }

  const freeRoleId = getFreeRoleId();
  const paidRoleId = getRoleId(planName);

  const rolesToAdd = [freeRoleId, paidRoleId].filter(Boolean);

  try {
    for (const roleId of rolesToAdd) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
        console.log(`✅ Role ${roleId} → ${member.user.tag}`);
      }
    }
    console.log(`🎉 Paid access granted: ${member.user.tag} → ${planName}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to assign role to ${member.user.tag}:`, err.message);
    return false;
  }
}

/**
 * Remove all paid roles, keep Free role.
 * Called when subscription is cancelled or expires.
 *
 * @param {string} discordId — Discord user ID
 */
async function removePaidRole(discordId) {
  const member = await getMember(discordId);
  if (!member) {
    console.warn(`⚠️  Member ${discordId} not in server — cannot remove roles.`);
    return false;
  }

  const paidRoleIds = getAllPaidRoleIds();

  try {
    for (const roleId of paidRoleIds) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        console.log(`🗑️  Removed paid role ${roleId} from ${member.user.tag}`);
      }
    }

    // Always ensure Free role is present
    const freeRoleId = getFreeRoleId();
    if (freeRoleId && !member.roles.cache.has(freeRoleId)) {
      await member.roles.add(freeRoleId);
      console.log(`✅ Kept/restored Free role for ${member.user.tag}`);
    }

    console.log(`🔄 ${member.user.tag} downgraded to Free tier`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to remove roles from ${member.user.tag}:`, err.message);
    return false;
  }
}

/**
 * Upgrade or switch between paid plans.
 * Removes old paid role, adds new paid role (keeps Free role).
 *
 * @param {string} discordId  — Discord user ID
 * @param {string} newPlan    — new plan name
 */
async function handlePlanChange(discordId, newPlan) {
  const member = await getMember(discordId);
  if (!member) return false;

  try {
    // Remove all paid roles first
    const paidRoleIds = getAllPaidRoleIds();
    for (const roleId of paidRoleIds) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    }
    // Add new paid role
    const newRoleId  = getRoleId(newPlan);
    const freeRoleId = getFreeRoleId();
    if (newRoleId)  await member.roles.add(newRoleId);
    if (freeRoleId && !member.roles.cache.has(freeRoleId)) await member.roles.add(freeRoleId);

    console.log(`🔄 Plan change: ${member.user.tag} → ${newPlan}`);
    return true;
  } catch (err) {
    console.error(`❌ Plan change failed for ${discordId}:`, err.message);
    return false;
  }
}

/**
 * Sync all existing members from DB.
 * Run this once to bring old subscribers into the new system.
 * Called via GET /admin/sync endpoint.
 */
async function syncAllMembers() {
  const members = db.getAllMembers();
  console.log(`🔄 Starting sync for ${members.length} members...`);
  let ok = 0, skip = 0, fail = 0;

  for (const record of members) {
    if (!record.discordId) { skip++; continue; }
    if (record.status === 'active' && record.plan) {
      const success = await assignPaidRole(record.discordId, record.plan);
      success ? ok++ : fail++;
    } else {
      const success = await removePaidRole(record.discordId);
      success ? ok++ : fail++;
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`✅ Sync complete: ${ok} ok, ${skip} skipped (no Discord ID), ${fail} failed`);
  return { ok, skip, fail, total: members.length };
}

// ── Login ─────────────────────────────────────────────────
function startBot() {
  client.login(process.env.DISCORD_BOT_TOKEN)
    .catch(err => console.error('❌ Bot login failed:', err.message));
}

module.exports = { client, startBot, assignPaidRole, removePaidRole, handlePlanChange, syncAllMembers };
