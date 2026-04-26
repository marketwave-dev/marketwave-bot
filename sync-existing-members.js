/**
 * sync-existing-members.js
 *
 * ONE-TIME SCRIPT — Run this ONCE to assign Discord roles to all 33 existing members.
 *
 * HOW TO RUN:
 * 1. Upload this file to your marketwave-bot GitHub repo
 * 2. Go to Render → marketwave-bot → Shell
 * 3. Type: node sync-existing-members.js
 * 4. Watch the logs — done in under 2 minutes
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const db = require('./db');

// ── All 33 existing members with Discord IDs and plans ────
const EXISTING_MEMBERS = [
  { email: 'dhruv.patel1684@gmail.com',      discordId: '1465588137039237351', plan: 'MarketWave Elite' },
  { email: 'creativelife2018@aol.com',        discordId: '1262494245428920320', plan: 'MarketWave Plus' },
  { email: 'er_hiteshpatel@yahoo.com',        discordId: '1404871730962370730', plan: 'MarketWave Elite' },
  { email: 'suraj.sansi4600@gmail.com',       discordId: '1455045236668629101', plan: 'MarketWave Elite' },
  { email: 'nik_pharmacist@yahoo.co.in',      discordId: '797290265823412246',  plan: 'MarketWave Elite' },
  { email: 'vincepateldba@gmail.com',         discordId: '1444907502956449984', plan: 'MarketWave Elite' },
  { email: 'dipen255@yahoo.com',              discordId: '789953931676876852',  plan: 'MarketWave Elite' },
  { email: 'saurabhcs@gmail.com',             discordId: '797227963334262805',  plan: 'MarketWave Elite' },
  { email: 'atmiyak16@gmail.com',             discordId: '1433546689012306001', plan: '5K to 50K Challenge' },
  { email: 'darpan.549@gmail.com',            discordId: '745370061572669582',  plan: 'MarketWave Elite' },
  { email: 'mogan_chem@yahoo.com',            discordId: '1304289580857425992', plan: 'MarketWave Elite' },
  { email: 'anupmehta@hotmail.com',           discordId: '745458086143328389',  plan: 'MarketWave Elite' },
  { email: 'harrypatel94@yahoo.com',          discordId: '1305983582124249133', plan: 'MarketWave Elite' },
  { email: 'ripatel31@gmail.com',             discordId: '780496076863701022',  plan: 'MarketWave Elite' },
  { email: 'hk.koratpally@gmail.com',         discordId: '804029164457164830',  plan: '5K to 50K Challenge' },
  { email: 'hkommera@yahoo.com',              discordId: '1413374094639890552', plan: 'MarketWave Elite' },
  { email: 'gunjpharmacy@gmail.com',          discordId: '1415731875691106415', plan: 'MarketWave Plus' },
  { email: 'sureshtopiwala@gmail.com',        discordId: '1413176435098517616', plan: 'MarketWave Plus' },
  { email: 'sansneathy@gmail.com',            discordId: '1406681142303920330', plan: 'MarketWave Elite' },
  { email: 'corban56@gmail.com',              discordId: '606453113339248646',  plan: 'MarketWave Plus' },
  { email: 'p_samir@yahoo.com',               discordId: '1403200484898111520', plan: 'MarketWave Elite' },
  { email: 'patelshreyas94@gmail.com',        discordId: '712145360302374994',  plan: 'MarketWave Elite' },
  { email: 'discord.basis421@passmail.net',   discordId: '1391851241746993155', plan: 'MarketWave Elite' },
  { email: 'ranjchou7@gmail.com',             discordId: '810944469142732872',  plan: 'MarketWave Elite' },
  { email: 'hpatel7363@gmail.com',            discordId: '1291411180635689065', plan: 'MarketWave Elite' },
  { email: 'patelurvish78@yahoo.com',         discordId: '1305544721401380915', plan: 'MarketWave Elite' },
  { email: 'vdyjay@gmail.com',                discordId: '784973584519004160',  plan: 'MarketWave Plus' },
  { email: 'jigarshah168@gmail.com',          discordId: '619197697022492685',  plan: '5K to 50K Challenge' },
  { email: 'neel1386@gmail.com',              discordId: '707053208148901960',  plan: 'MarketWave Elite' },
  { email: 'ankur.251088@gmail.com',          discordId: '1337487339768774796', plan: 'MarketWave Elite' },
  { email: 'arpit.dpatel1026@gmail.com',      discordId: '1295174424999497728', plan: 'MarketWave Elite' },
  { email: 'gazyspy@gmail.com',               discordId: '916085061869269013',  plan: 'MarketWave Elite' },
];

// ── Role ID map ───────────────────────────────────────────
const ROLE_IDS = {
  free:  process.env.ROLE_FREE,   // Members
  '5k':  process.env.ROLE_5K,    // Member_5k
  plus:  process.env.ROLE_PLUS,  // Member_Plus
  elite: process.env.ROLE_ELITE, // Member_Elite
};

const PLAN_TO_KEY = {
  '5K to 50K Challenge': '5k',
  'MarketWave Plus':     'plus',
  'MarketWave Elite':    'elite',
};

const GUILD_ID = process.env.DISCORD_GUILD_ID;

// ── Discord client ────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async () => {
  console.log(`\n✅ Bot connected: ${client.user.tag}`);
  console.log(`🔄 Starting sync for ${EXISTING_MEMBERS.length} members...\n`);

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.members.fetch(); // cache all members

  let ok = 0, skip = 0, fail = 0;

  for (const member of EXISTING_MEMBERS) {
    const { email, discordId, plan } = member;
    const planKey   = PLAN_TO_KEY[plan];
    const freeRole  = ROLE_IDS.free;
    const paidRole  = planKey ? ROLE_IDS[planKey] : null;

    try {
      const guildMember = await guild.members.fetch(discordId).catch(() => null);

      if (!guildMember) {
        console.log(`⚠️  SKIP — Not in server: ${email} (${discordId})`);
        skip++;
        continue;
      }

      // Assign Free role
      if (freeRole && !guildMember.roles.cache.has(freeRole)) {
        await guildMember.roles.add(freeRole);
      }

      // Assign Paid role
      if (paidRole && !guildMember.roles.cache.has(paidRole)) {
        await guildMember.roles.add(paidRole);
      }

      // Save to DB so bot tracks them going forward
      db.saveMember({
        stripeCustomerId: `legacy_${discordId}`,
        discordId,
        discordUsername:  guildMember.user.username,
        email,
        name:             guildMember.displayName,
        plan,
        status:           'active',
      });

      console.log(`✅ ${guildMember.user.username} (${email}) → ${plan}`);
      ok++;

    } catch (err) {
      console.log(`❌ FAIL — ${email}: ${err.message}`);
      fail++;
    }

    // Small delay to avoid Discord rate limits
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\n════════════════════════════════`);
  console.log(`✅ Done! Synced: ${ok} | Skipped: ${skip} | Failed: ${fail}`);
  console.log(`════════════════════════════════\n`);

  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
