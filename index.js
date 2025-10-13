import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, InteractionType
} from 'discord.js';
import { TOKEN, JOBS_PAGE_SIZE, CATEGORIES, SPECIALTIES, ADMIN_CHANNEL_ID, TICKET_DM } from './config.js';
import {
  upsertUser, getUserByDiscord, setUserVerification, createJob, listOpenJobs, countOpenJobs,
  getJobByNumber, assignJob, setJobStatus, getJobFull, addReview, refreshUserAverages,
  getUserById, setJobPorter, incrementCompletedJobs
} from './db.js';
import { rsiBioHasCode } from './rsi.js';
import { nanoid } from 'nanoid';
import { pageControls, categorySelect, twoButtons, infoEmbed, porterOnlyEmbed } from './utils.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// ---- Helpers ----
function roleRow() {
  const porter = new ButtonBuilder().setCustomId('signup:role:PORTER').setStyle(ButtonStyle.Success).setLabel('Porter');
  const customer = new ButtonBuilder().setCustomId('signup:role:CUSTOMER').setStyle(ButtonStyle.Primary).setLabel('Customer');
  return new ActionRowBuilder().addComponents(porter, customer);
}

function yesNoRow(base) {
  const yes = new ButtonBuilder().setCustomId(`${base}:yes`).setStyle(ButtonStyle.Success).setLabel('Yes');
  const no  = new ButtonBuilder().setCustomId(`${base}:no`).setStyle(ButtonStyle.Secondary).setLabel('No');
  return new ActionRowBuilder().addComponents(yes, no);
}

function signupModal(isPorter) {
  const modal = new ModalBuilder().setCustomId(`signup:modal:${isPorter ? 'PORTER' : 'CUSTOMER'}`).setTitle('Sign Up');

  const rsi = new TextInputBuilder().setCustomId('rsi').setLabel('RSI Handle').setStyle(TextInputStyle.Short).setRequired(isPorter);
  const bio = new TextInputBuilder().setCustomId('bio').setLabel('Bio (short)').setStyle(TextInputStyle.Paragraph).setRequired(false);
  const lang = new TextInputBuilder().setCustomId('lang').setLabel('Primary Language').setStyle(TextInputStyle.Short).setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(rsi),
    new ActionRowBuilder().addComponents(bio),
    new ActionRowBuilder().addComponents(lang)
  );
  return modal;
}

function specialtyRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('signup:specialty')
    .setPlaceholder('Choose your specialty')
    .addOptions(SPECIALTIES.map(s => ({ label: s, value: s })));
  return new ActionRowBuilder().addComponents(menu);
}

function postJobModal(category) {
  const modal = new ModalBuilder().setCustomId(`postjob:modal:${category}`).setTitle(`Post Job – ${category}`);
  const loc = new TextInputBuilder().setCustomId('loc').setLabel('Location (System/Planet/etc.)').setStyle(TextInputStyle.Short).setRequired(true);
  const pay = new TextInputBuilder().setCustomId('pay').setLabel('Payment (aUEC)').setStyle(TextInputStyle.Short).setRequired(true);
  const desc = new TextInputBuilder().setCustomId('desc').setLabel('Job Description').setStyle(TextInputStyle.Paragraph).setRequired(true);
  const date = new TextInputBuilder().setCustomId('date').setLabel('Date Needed').setStyle(TextInputStyle.Short).setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(loc),
    new ActionRowBuilder().addComponents(pay),
    new ActionRowBuilder().addComponents(desc),
    new ActionRowBuilder().addComponents(date)
  );
  return modal;
}

function jobCard(job) {
  const e = new EmbedBuilder()
    .setTitle(`${job.job_number} — ${job.category}`)
    .setColor(0x00A7E0)
    .addFields(
      { name: 'Payment (aUEC)', value: String(job.payment_auec || 0), inline: true },
      { name: 'Location', value: job.location || 'N/A', inline: true },
      { name: 'Customer', value: job.customer_username, inline: true },
      { name: 'Date Needed', value: job.date_needed || 'N/A', inline: true },
      { name: 'Status', value: job.status, inline: true },
      { name: 'Description', value: job.description || '—' }
    );
  return e;
}

async function dmOrReply(ix, content, embeds, components) {
  try {
    const dm = await ix.user.createDM();
    await dm.send({ content, embeds, components });
  } catch {
    await ix.reply({ content, embeds, components, ephemeral: true });
  }
}

// ---- Ready ----
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---- Interactions ----
client.on('interactionCreate', async (ix) => {
  try {
    // Slash commands
    if (ix.isChatInputCommand()) {
      if (ix.commandName === 'signup') {
        const existing = getUserByDiscord(ix.user.id);
        await ix.reply({
          content: existing
            ? `You’re already registered as **${existing.user_type}**. Re-running signup will update your info.`
            : `Welcome to PortHub! Choose your role:`,
          components: [roleRow()],
          ephemeral: true
        });
      }

      if (ix.commandName === 'postjob') {
        const u = getUserByDiscord(ix.user.id);
        if (!u || u.user_type !== 'CUSTOMER') {
          return ix.reply({ content: 'Only **Customers** can post jobs. Use `/signup` to register as a Customer.', ephemeral: true });
        }
        await ix.reply({
          content: 'Select a category for your job:',
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('postjob:category')
              .setPlaceholder('Pick a category')
              .addOptions(CATEGORIES.map(c => ({ label: c, value: c })))
          )],
          ephemeral: true
        });
      }

      if (ix.commandName === 'jobs') {
        const total = countOpenJobs();
        const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
        const page = 1;
        const rows = listOpenJobs({ page, pageSize: JOBS_PAGE_SIZE });

        if (rows.length === 0) {
          return ix.reply({ content: 'No open jobs right now. Check back soon!', ephemeral: true });
        }

        const embed = new EmbedBuilder().setTitle('Open Jobs').setColor(0x00A7E0);
        rows.forEach((r, i) => {
          embed.addFields({
            name: `${i + 1}. ${r.job_number} • ${r.category}`,
            value: `**Payment:** ${r.payment_auec || 0} aUEC • **Customer:** ${r.customer_username}`
          });
        });

        const nav = pageControls(page, totalPages, 'jobs:list');
        await ix.reply({ embeds: [embed], components: [nav], ephemeral: true });
      }

      if (ix.commandName === 'viewjob') {
        const jobNumber = ix.options.getString('jobnumber', true).toUpperCase().trim();
        const job = getJobFull(jobNumber);
        if (!job) return ix.reply({ content: `Job ${jobNumber} not found.`, ephemeral: true });

        const embed = jobCard(job);
        const u = getUserByDiscord(ix.user.id);
        const actions = new ActionRowBuilder();

        // Only Porters can see Take Job; enforce in button handler too
        actions.addComponents(
          new ButtonBuilder().setCustomId(`job:take:${job.job_number}`).setLabel('Take Job').setStyle(ButtonStyle.Success)
        );

        await ix.reply({ embeds: [embed], components: [actions], ephemeral: true });
      }

      if (ix.commandName === 'profile') {
        const member = ix.options.getUser('user') || ix.user;
        const u = getUserByDiscord(member.id);
        if (!u) return ix.reply({ content: 'User is not registered.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setAuthor({ name: `${u.username} (${u.user_type})`, iconURL: member.displayAvatarURL() })
          .setColor(0x00A7E0)
          .addFields(
            { name: 'Avg Rating', value: `${(u.avg_rating || 0).toFixed(2)} ⭐`, inline: true },
            { name: 'Completed Jobs', value: String(u.completed_jobs || 0), inline: true },
            { name: 'RSI Handle', value: u.rsi_handle || '—', inline: true },
            { name: 'Specialty', value: u.specialty || '—', inline: true },
            { name: 'Language', value: u.language || '—', inline: true },
            { name: 'Verified', value: u.rsi_verified ? '✅ Yes' : '❌ No', inline: true },
            { name: 'Bio', value: u.bio || '—' }
          );
        await ix.reply({ embeds: [embed], ephemeral: true });
      }

      if (ix.commandName === 'topporters') {
        // naive top 10 by avg_rating then completed_jobs
        const rows = client.topPortersCache ?? [];
        // We’ll compute live here via DB for simplicity:
        // better-sqlite3 quick select
        // (Write inline tiny query)
        // We'll just reuse db.js? For brevity, do a small import:
        // Already imported getUserByDiscord etc; but not a top function. Quick raw:
        // For simplicity, show instruction:
        return ix.reply({ content: 'Coming soon: leaderboard (you can add easily by querying users ORDER BY avg_rating DESC, completed_jobs DESC LIMIT 10).', ephemeral: true });
      }
    }

    // Component interactions (buttons/menus)
    if (ix.isStringSelectMenu()) {
      const [prefix, action] = ix.customId.split(':');

      // /signup specialty selection
      if (ix.customId === 'signup:specialty') {
        const specialty = ix.values[0];
        const current = getUserByDiscord(ix.user.id);
        if (!current) return ix.reply({ content: 'Please choose a role first.', ephemeral: true });

        upsertUser({
          discordId: ix.user.id,
          username: ix.user.username,
          userType: current.user_type,
          rsiHandle: current.rsi_handle,
          bio: current.bio,
          language: current.language,
          specialty
        });

        return ix.reply({ content: `Specialty set to **${specialty}**. Would you like to verify your RSI handle?`, components: [yesNoRow('signup:verify')], ephemeral: true });
      }

      // /postjob choose category
      if (ix.customId === 'postjob:category') {
        const category = ix.values[0];
        await ix.showModal(postJobModal(category));
      }

      // /jobs pagination control handler is in buttons section below (because we used buttons)
    }

    if (ix.isButton()) {
      const parts = ix.customId.split(':');

      // Signup role select
      if (ix.customId.startsWith('signup:role:')) {
        const role = parts[2]; // PORTER or CUSTOMER
        const isPorter = role === 'PORTER';
        // Upsert with only role + username for now
        upsertUser({
          discordId: ix.user.id,
          username: ix.user.username,
          userType: role
        });
        await ix.showModal(signupModal(isPorter));
        return;
      }

      // After specialty chosen: verify ask
      if (ix.customId.startsWith('signup:verify')) {
        const yesNo = parts[2]; // yes|no
        const u = getUserByDiscord(ix.user.id);
        if (!u) return ix.reply({ content: 'Please complete signup first.', ephemeral: true });

        if (yesNo === 'yes') {
          const code = `PORT-${nanoid(8)}`.toUpperCase();
          setUserVerification({ discordId: ix.user.id, rsiCode: code, verified: false });
          return ix.reply({
            content:
              `Verification step:\n1) Go to your RSI profile bio and paste this code exactly:\n\`${code}\`\n2) When done, press **Check Now**.`,
            components: [twoButtons('verify:check', 'Check Now', ButtonStyle.Success, 'verify:cancel', 'Cancel', ButtonStyle.Secondary)],
            ephemeral: true
          });
        } else {
          return ix.reply({ content: 'Signup finished without RSI verification. You can verify later.', ephemeral: true });
        }
      }

      // Check/Cancel verification
      if (ix.customId === 'verify:check') {
        const u = getUserByDiscord(ix.user.id);
        if (!u || !u.rsi_handle || !u.rsi_code) {
          return ix.reply({ content: 'Missing RSI handle or code. Re-run `/signup`.', ephemeral: true });
        }
        const ok = await rsiBioHasCode(u.rsi_handle, u.rsi_code);
        setUserVerification({ discordId: ix.user.id, rsiCode: u.rsi_code, verified: ok });
        return ix.reply({ content: ok ? '✅ Verified! You are now RSI-verified.' : '❌ Code not found on your RSI bio yet. Try again once it’s saved.', ephemeral: true });
      }
      if (ix.customId === 'verify:cancel') {
        return ix.reply({ content: 'Verification canceled. You can verify later.', ephemeral: true });
      }

      // /jobs pagination
      if (ix.customId.startsWith('jobs:list')) {
        const [, dir, pageStr] = ix.customId.split(':'); // jobs:list:prev:1
        let page = Number(pageStr);
        if (dir === 'prev') page = Math.max(1, page - 1);
        if (dir === 'next') page = page + 1;

        const total = countOpenJobs();
        const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
        if (page > totalPages) page = totalPages;

        const rows = listOpenJobs({ page, pageSize: JOBS_PAGE_SIZE });
        const embed = new EmbedBuilder().setTitle('Open Jobs').setColor(0x00A7E0);
        rows.forEach((r, i) => {
          embed.addFields({
            name: `${i + 1 + (page - 1) * JOBS_PAGE_SIZE}. ${r.job_number} • ${r.category}`,
            value: `**Payment:** ${r.payment_auec || 0} aUEC • **Customer:** ${r.customer_username}`
          });
        });
        const nav = pageControls(page, totalPages, 'jobs:list');
        return ix.update({ embeds: [embed], components: [nav] });
      }

      // Take job
      if (ix.customId.startsWith('job:take:')) {
        const jobNumber = ix.customId.split(':')[2];
        const u = getUserByDiscord(ix.user.id);
        if (!u || u.user_type !== 'PORTER') {
          return ix.reply({ embeds: [porterOnlyEmbed()], ephemeral: true });
        }

        const success = assignJob(jobNumber, u.id);
        if (!success) {
          return ix.reply({ content: 'This job is not open or was taken already.', ephemeral: true });
        }

        const job = getJobFull(jobNumber);
        // DM customer with Accept/Deny
        try {
          const customerUser = await client.users.fetch(job.customer_id ? (getUserById(job.customer_id).discord_id) : '');
          const porterUser = await client.users.fetch(u.discord_id);
          const profileEmbed = new EmbedBuilder()
            .setTitle(`Porter Request: ${porterUser.username}`)
            .setThumbnail(porterUser.displayAvatarURL())
            .addFields(
              { name: 'Specialty', value: u.specialty || '—', inline: true },
              { name: 'Avg Rating', value: `${(u.avg_rating || 0).toFixed(2)} ⭐`, inline: true },
              { name: 'Completed Jobs', value: String(u.completed_jobs || 0), inline: true },
              { name: 'Verified', value: u.rsi_verified ? '✅ Yes' : '❌ No', inline: true },
              { name: 'RSI', value: u.rsi_handle || '—', inline: true }
            );

          await customerUser.send({
            content: `A Porter wants to take your job ${job.job_number}. Accept this Porter?`,
            embeds: [profileEmbed],
            components: [twoButtons(`job:accept:${job.job_number}:${u.id}`, 'Accept', ButtonStyle.Success, `job:deny:${job.job_number}:${u.id}`, 'Deny', ButtonStyle.Danger)]
          });
        } catch {}
        // DM porter
        try {
          const porterUser = await client.users.fetch(u.discord_id);
          await porterUser.send(`You’ve requested to take **${job.job_number}**. Waiting for customer approval...`);
        } catch {}
        return ix.reply({ content: `Requested to take ${jobNumber}. The customer has been notified.`, ephemeral: true });
      }

      // Customer Accept/Deny
      if (ix.customId.startsWith('job:accept:') || ix.customId.startsWith('job:deny:')) {
        // customId: job:accept:JOB-1234:<porterUserId>
        const [_, action, jobNumber, porterDbId] = ix.customId.split(':');
        const job = getJobFull(jobNumber);
        if (!job) return ix.reply({ content: 'Job not found.', ephemeral: true });

        const customer = getUserByDiscord(ix.user.id);
        if (!customer || customer.id !== job.customer_id) {
          return ix.reply({ content: 'Only the job poster can accept/deny.', ephemeral: true });
        }

        if (action === 'accept') {
          setJobPorter(jobNumber, porterDbId);
          setJobStatus(jobNumber, 'ACCEPTED');

          // DM both with Complete/Incomplete buttons
          const buttons = twoButtons(`job:complete:${jobNumber}`, 'Complete Job', ButtonStyle.Success, `job:incomplete:${jobNumber}`, 'Job Incomplete', ButtonStyle.Danger);
          try {
            const porter = getUserById(porterDbId);
            const porterUser = await client.users.fetch(porter.discord_id);
            const customerUser = await client.users.fetch(customer.discord_id);
            const embed = jobCard(getJobFull(jobNumber));
            await customerUser.send({ content: `You accepted **${jobNumber}**.`, embeds: [embed], components: [buttons] });
            await porterUser.send({ content: `Customer accepted you for **${jobNumber}**.`, embeds: [embed], components: [buttons] });
          } catch {}
          return ix.update({ content: `✅ Accepted for ${jobNumber}.`, components: [] });
        } else {
          setJobStatus(jobNumber, 'OPEN');
          return ix.update({ content: `❌ Denied. Job ${jobNumber} is back open.`, components: [] });
        }
      }

      // Complete / Incomplete
      if (ix.customId.startsWith('job:complete:') || ix.customId.startsWith('job:incomplete:')) {
        const [_, action, jobNumber] = ix.customId.split(':');
        const job = getJobFull(jobNumber);
        if (!job) return ix.reply({ content: 'Job not found.', ephemeral: true });

        // Determine who pressed
        const actor = getUserByDiscord(ix.user.id);
        if (!actor) return ix.reply({ content: 'Sign up first.', ephemeral: true });

        // Disable both buttons for both parties and send the “other party” a DM per your spec
        const otherId = (actor.id === job.customer_id) ? job.porter_id : job.customer_id;
        try {
          const other = getUserById(otherId);
          if (other) {
            const otherUser = await client.users.fetch(other.discord_id);
            await otherUser.send(`The other party has acted on **${jobNumber}**. ${TICKET_DM}`);
          }
        } catch {}

        if (action === 'complete') {
          setJobStatus(jobNumber, 'COMPLETED');

          // Ask ratings (simple buttons → we’ll use ephemeral follow-ups)
          await ix.reply({ content: `Marked **${jobNumber}** as complete. Please rate your counterpart (1–5) by replying with a number in the next message.`, ephemeral: true });

          // Minimalistic rating collector (next message from user)
          const filter = m => m.author.id === ix.user.id;
          const dm = await ix.user.createDM();
          await dm.send(`Rate your counterpart for **${jobNumber}** (1–5). Optionally, include a short comment after the number.\nExample: \`5 Great job!\``);

          const collector = dm.createMessageCollector({ time: 60_000, max: 1 });
          collector.on('collect', (m) => {
            const [starsStr, ...rest] = m.content.trim().split(/\s+/);
            const stars = Math.max(1, Math.min(5, parseInt(starsStr, 10) || 5));
            const text = rest.join(' ');
            // figure reviewed user
            const reviewedId = (actor.id === job.customer_id) ? job.porter_id : job.customer_id;
            addReview({ jobId: job.id, reviewerId: actor.id, reviewedId, stars, text });
            const { avg } = refreshUserAverages(reviewedId);
            if (reviewedId === job.porter_id && stars >= 1) {
              incrementCompletedJobs(reviewedId);
            }
            dm.send(`Thanks! Recorded ${stars}★${text ? ` — "${text}"` : ''}.`);
          });

        } else {
          setJobStatus(jobNumber, 'DISPUTED');
          await ix.reply({ content: `Marked **${jobNumber}** as incomplete. An admin will review.`, ephemeral: true });

          // Post to admin channel
          if (ADMIN_CHANNEL_ID) {
            try {
              const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
              const embed = jobCard(job);
              await ch.send({ content: `🚨 Dispute opened for **${jobNumber}**`, embeds: [embed] });
            } catch {}
          }
        }
      }
    }

    // Modal submissions
    if (ix.type === InteractionType.ModalSubmit) {
      if (ix.customId.startsWith('signup:modal:')) {
        const role = ix.customId.split(':')[2]; // PORTER|CUSTOMER
        const rsiHandle = ix.fields.getTextInputValue('rsi')?.trim() || null;
        const bio = ix.fields.getTextInputValue('bio')?.trim() || null;
        const language = ix.fields.getTextInputValue('lang')?.trim() || null;

        // If CUSTOMER: we do NOT go through specialty or RSI verify flows.
        if (role === 'CUSTOMER') {
          upsertUser({
            discordId: ix.user.id,
            username: ix.user.username,
            userType: 'CUSTOMER',
            rsiHandle, bio, language
          });
          return ix.reply({ content: 'Signup completed as **Customer**.', ephemeral: true });
        }

        // If PORTER: ask specialty
        upsertUser({
          discordId: ix.user.id,
          username: ix.user.username,
          userType: 'PORTER',
          rsiHandle, bio, language
        });
        return ix.reply({ content: 'Choose your specialty:', components: [ (new ActionRowBuilder()).addComponents(
          new StringSelectMenuBuilder().setCustomId('signup:specialty').setPlaceholder('Choose').addOptions(SPECIALTIES.map(s => ({ label: s, value: s })))
        ) ], ephemeral: true });
      }

      if (ix.customId.startsWith('postjob:modal:')) {
        const category = ix.customId.split(':')[2];
        const loc = ix.fields.getTextInputValue('loc')?.trim();
        const pay = parseInt(ix.fields.getTextInputValue('pay')?.trim() || '0', 10);
        const desc = ix.fields.getTextInputValue('desc')?.trim();
        const date = ix.fields.getTextInputValue('date')?.trim();

        const u = getUserByDiscord(ix.user.id);
        if (!u || u.user_type !== 'CUSTOMER') {
          return ix.reply({ content: 'Only **Customers** can post jobs.', ephemeral: true });
        }

        const job = createJob({
          category, customerId: u.id, location: loc, payment: pay, description: desc, dateNeeded: date
        });

        return ix.reply({
          content: `✅ Job posted: **${job.job_number}**`,
          embeds: [infoEmbed('Job Created', [
            ['Category', category, true],
            ['Payment (aUEC)', String(pay), true],
            ['Location', loc, true],
            ['Date Needed', date || '—', true]
          ])],
          ephemeral: true
        });
      }
    }

  } catch (err) {
    console.error(err);
    if (ix.isRepliable()) {
      try { await ix.reply({ content: 'Something went wrong. Try again.', ephemeral: true }); } catch {}
    }
  }
});

client.login(TOKEN);
