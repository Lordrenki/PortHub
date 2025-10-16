import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, InteractionType, SlashCommandBuilder, REST, Routes
} from 'discord.js';
import { TOKEN, JOBS_PAGE_SIZE, CATEGORIES, SPECIALTIES, ADMIN_CHANNEL_ID, TICKET_DM, CLIENT_ID, GUILD_ID } from './config.js';
import {
  upsertUser, getUserByDiscord, setUserVerification, createJob, listOpenJobs, countOpenJobs,
  getJobByNumber, assignJob, setJobStatus, getJobFull, addFeedback, refreshUserFeedback,
  getUserById, setJobPorter, incrementCompletedJobs, updateUserType, updateUserBio, deleteUser,
  setJobCompletionMessages, clearJobCompletionMessages
} from './db.js';
import { rsiBioHasCode } from './rsi.js';
import { nanoid } from 'nanoid';
import { pageControls, twoButtons, infoEmbed, porterOnlyEmbed, withFooter, jobCard } from './utils.js';

/**
 * FULL REWRITE NOTES
 * - Allows BOTH Porters and Customers to post jobs (restriction removed).
 * - Adds /deleteprofile (only Discord ID 1395110823898255442 may execute).
 * - Profile view shows owner-only buttons in ONE message:
 *     - Switch role (shows only the option they AREN'T already)
 *     - Edit bio (modal)
 * - Adds /editprofile to open the same modal via command.
 * - Keeps original jobs listing, view job, take job, acceptance, dispute, completion, and like/dislike feedback flow.
 *
 * DB EXPECTATIONS (SQLite via ./db.js):
 * - updateUserType({ discordId, userType })
 * - updateUserBio({ discordId, bio })
 * - deleteUser({ discordId })
 * If your db.js doesn't have these yet, add thin wrappers there to run the SQL.
 */

const OWNER_ID = '1395110823898255442';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// ---------------- UI HELPERS ----------------
function roleSwitchRow(currentRole) {
  const row = new ActionRowBuilder();
  if (currentRole === 'PORTER') {
    row.addComponents(new ButtonBuilder().setCustomId('profile:switch:CUSTOMER').setStyle(ButtonStyle.Primary).setLabel('Switch to Customer'));
  } else if (currentRole === 'CUSTOMER') {
    row.addComponents(new ButtonBuilder().setCustomId('profile:switch:PORTER').setStyle(ButtonStyle.Success).setLabel('Switch to Porter'));
  }
  row.addComponents(new ButtonBuilder().setCustomId('profile:editbio').setStyle(ButtonStyle.Secondary).setLabel('Edit Bio'));
  return row;
}

function signupRoleRow() {
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

function editProfileModal() {
  const modal = new ModalBuilder().setCustomId('profile:modal:edit').setTitle('Edit Profile');
  const bio = new TextInputBuilder().setCustomId('bio').setLabel('Bio (short)').setStyle(TextInputStyle.Paragraph).setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(bio));
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

// ---------------- COMMAND REGISTRATION ----------------
const commands = [
  new SlashCommandBuilder().setName('signup').setDescription('Register or update your profile.'),
  new SlashCommandBuilder().setName('postjob').setDescription('Post a new job (Porter or Customer).'),
  new SlashCommandBuilder().setName('jobs').setDescription('List open jobs.'),
  new SlashCommandBuilder().setName('viewjob').setDescription('View a job by number.').addStringOption(o => o.setName('jobnumber').setDescription('Job number (e.g., JOB-1234)').setRequired(true)),
  new SlashCommandBuilder().setName('profile').setDescription('View a profile.').addUserOption(o => o.setName('user').setDescription('User to view')),
  new SlashCommandBuilder().setName('editprofile').setDescription('Open the Edit Profile modal.'),
  new SlashCommandBuilder().setName('deleteprofile').setDescription('Delete a user profile (Owner only).').addUserOption(o => o.setName('user').setDescription('User to delete').setRequired(true)),
  new SlashCommandBuilder().setName('topporters').setDescription('Show top porters (coming soon).')
].map(c => c.toJSON());

async function registerCommands() {
  if (!CLIENT_ID) return;
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    }
    console.log('✅ Slash commands registered');
  } catch (e) {
    console.error('Failed to register commands', e);
  }
}

// ---------------- READY ----------------
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ---------------- INTERACTIONS ----------------

async function handleChatInputCommand(ix) {
  switch (ix.commandName) {
    case 'signup': {
      const existing = getUserByDiscord(ix.user.id);
      await ix.reply({
        content: existing
          ? `You’re already registered as **${existing.user_type}**. Re-running signup will update your info.`
          : 'Welcome to PortHub! Choose your role:',
        components: [signupRoleRow()],
        ephemeral: true
      });
      return;
    }
    case 'postjob': {
      const u = getUserByDiscord(ix.user.id);
      if (!u) {
        await ix.reply({ content: 'Register first with `/signup`.', ephemeral: true });
        return;
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
      return;
    }
    case 'jobs': {
      const total = countOpenJobs();
      const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
      const page = 1;
      const rows = listOpenJobs({ page, pageSize: JOBS_PAGE_SIZE });

      if (rows.length === 0) {
        await ix.reply({ content: 'No open jobs right now. Check back soon!', ephemeral: true });
        return;
      }

      const embed = withFooter(new EmbedBuilder().setTitle('Open Jobs').setColor(0x00A7E0));
      rows.forEach((r, i) => {
        embed.addFields({
          name: `${i + 1}. ${r.job_number} • ${r.category}`,
          value: `**Payment:** ${r.payment_auec || 0} aUEC • **Customer:** ${r.customer_username}`
        });
      });

      const nav = pageControls(page, totalPages, 'jobs:list');
      await ix.reply({ embeds: [embed], components: [nav], ephemeral: true });
      return;
    }
    case 'viewjob': {
      const jobNumber = ix.options.getString('jobnumber', true).toUpperCase().trim();
      const job = getJobFull(jobNumber);
      if (!job) {
        await ix.reply({ content: `Job ${jobNumber} not found.`, ephemeral: true });
        return;
      }

      const embed = jobCard(job);
      const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`job:take:${job.job_number}`).setLabel('Take Job').setStyle(ButtonStyle.Success)
      );

      await ix.reply({ embeds: [embed], components: [actions], ephemeral: true });
      return;
    }
    case 'profile': {
      const member = ix.options.getUser('user') || ix.user;
      const u = getUserByDiscord(member.id);
      if (!u) {
        await ix.reply({ content: 'User is not registered.', ephemeral: true });
        return;
      }

      const embed = withFooter(new EmbedBuilder()
        .setAuthor({ name: `${u.username} (${u.user_type})`, iconURL: member.displayAvatarURL() })
        .setColor(0x00A7E0)
        .addFields(
          { name: 'Likes', value: `${u.likes_count || 0} 👍`, inline: true },
          { name: 'Completed Jobs', value: String(u.completed_jobs || 0), inline: true },
          { name: 'RSI Handle', value: u.rsi_handle || '—', inline: true },
          { name: 'Specialty', value: u.specialty || '—', inline: true },
          { name: 'Language', value: u.language || '—', inline: true },
          { name: 'Verified', value: u.rsi_verified ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Bio', value: u.bio || '—' }
        ));

      const components = [];
      if (member.id === ix.user.id) {
        components.push(roleSwitchRow(u.user_type));
      }

      await ix.reply({ embeds: [embed], components, ephemeral: true });
      return;
    }
    case 'editprofile': {
      const u = getUserByDiscord(ix.user.id);
      if (!u) {
        await ix.reply({ content: 'Register first with `/signup`.', ephemeral: true });
        return;
      }
      await ix.showModal(editProfileModal());
      return;
    }
    case 'deleteprofile': {
      if (ix.user.id !== OWNER_ID) {
        await ix.reply({ content: 'This command is restricted.', ephemeral: true });
        return;
      }

      const target = ix.options.getUser('user', true);
      const userRow = getUserByDiscord(target.id);
      if (!userRow) {
        await ix.reply({ content: 'That user is not registered.', ephemeral: true });
        return;
      }

      try {
        const dm = await target.createDM();
        await dm.send('Your PortHub profile has been deleted by an admin. Jobs and reviews remain intact.');
      } catch {}

      deleteUser({ discordId: target.id });
      await ix.reply({ content: `Deleted profile for **${userRow.username}**.`, ephemeral: true });
      return;
    }
    case 'topporters': {
      await ix.reply({ content: 'Coming soon: leaderboard (query users ORDER BY likes_count DESC, completed_jobs DESC LIMIT 10).', ephemeral: true });
      return;
    }
    default:
      return;
  }
}

async function handleSelectMenu(ix) {
  if (ix.customId === 'signup:specialty') {
    const specialty = ix.values[0];
    const current = getUserByDiscord(ix.user.id);
    if (!current) {
      await ix.reply({ content: 'Please choose a role first.', ephemeral: true });
      return;
    }

    upsertUser({
      discordId: ix.user.id,
      username: ix.user.username,
      userType: current.user_type,
      rsiHandle: current.rsi_handle,
      bio: current.bio,
      language: current.language,
      specialty
    });

    await ix.reply({
      content: `Specialty set to **${specialty}**. Would you like to verify your RSI handle?`,
      components: [yesNoRow('signup:verify')],
      ephemeral: true
    });
    return;
  }

  if (ix.customId === 'postjob:category') {
    const category = ix.values[0];
    await ix.showModal(postJobModal(category));
  }
}

async function handleButtonInteraction(ix) {
  const parts = ix.customId.split(':');

  if (ix.customId.startsWith('signup:role:')) {
    const role = parts[2];
    const isPorter = role === 'PORTER';
    upsertUser({ discordId: ix.user.id, username: ix.user.username, userType: role });
    await ix.showModal(signupModal(isPorter));
    return;
  }

  if (ix.customId.startsWith('signup:verify')) {
    const yesNo = parts[2];
    const u = getUserByDiscord(ix.user.id);
    if (!u) {
      await ix.reply({ content: 'Please complete signup first.', ephemeral: true });
      return;
    }

    if (yesNo === 'yes') {
      const code = `PORT-${nanoid(8)}`.toUpperCase();
      setUserVerification({ discordId: ix.user.id, rsiCode: code, verified: false });
      await ix.reply({
        content: `Verification step:\n1) Go to your RSI profile bio and paste this code exactly:\n\`${code}\`\n2) When done, press **Check Now**.`,
        components: [twoButtons('verify:check', 'Check Now', ButtonStyle.Success, 'verify:cancel', 'Cancel', ButtonStyle.Secondary)],
        ephemeral: true
      });
    } else {
      await ix.reply({ content: 'Signup finished without RSI verification. You can verify later.', ephemeral: true });
    }
    return;
  }

  if (ix.customId === 'verify:check') {
    const u = getUserByDiscord(ix.user.id);
    if (!u || !u.rsi_handle || !u.rsi_code) {
      await ix.reply({ content: 'Missing RSI handle or code. Re-run `/signup`.', ephemeral: true });
      return;
    }
    const ok = await rsiBioHasCode(u.rsi_handle, u.rsi_code);
    setUserVerification({ discordId: ix.user.id, rsiCode: u.rsi_code, verified: ok });
    await ix.reply({
      content: ok ? '✅ Verified! You are now RSI-verified.' : '❌ Code not found on your RSI bio yet. Try again once it’s saved.',
      ephemeral: true
    });
    return;
  }

  if (ix.customId === 'verify:cancel') {
    await ix.reply({ content: 'Verification canceled. You can verify later.', ephemeral: true });
    return;
  }

  if (ix.customId.startsWith('jobs:list')) {
    const [, dir, pageStr] = parts;
    let page = Number(pageStr);
    if (dir === 'prev') page = Math.max(1, page - 1);
    if (dir === 'next') page = page + 1;

    const total = countOpenJobs();
    const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
    if (page > totalPages) page = totalPages;

    const rows = listOpenJobs({ page, pageSize: JOBS_PAGE_SIZE });
    const embed = withFooter(new EmbedBuilder().setTitle('Open Jobs').setColor(0x00A7E0));
    rows.forEach((r, i) => {
      embed.addFields({
        name: `${i + 1 + (page - 1) * JOBS_PAGE_SIZE}. ${r.job_number} • ${r.category}`,
        value: `**Payment:** ${r.payment_auec || 0} aUEC • **Customer:** ${r.customer_username}`
      });
    });
    const nav = pageControls(page, totalPages, 'jobs:list');
    await ix.update({ embeds: [embed], components: [nav] });
    return;
  }

  if (ix.customId.startsWith('job:take:')) {
    const jobNumber = parts[2];
    const porter = getUserByDiscord(ix.user.id);
    if (!porter || porter.user_type !== 'PORTER') {
      await ix.reply({ embeds: [porterOnlyEmbed()], ephemeral: true });
      return;
    }

    const success = assignJob(jobNumber, porter.id);
    if (!success) {
      await ix.reply({ content: 'This job is not open or was taken already.', ephemeral: true });
      return;
    }

    const job = getJobFull(jobNumber);
    const customerRecord = job?.customer_id ? getUserById(job.customer_id) : null;

    if (customerRecord) {
      try {
        const customerUser = await client.users.fetch(customerRecord.discord_id);
        const porterUser = await client.users.fetch(porter.discord_id);
        const profileEmbed = withFooter(new EmbedBuilder()
          .setTitle(`Porter Request: ${porterUser.username}`)
          .setThumbnail(porterUser.displayAvatarURL())
          .addFields(
            { name: 'Specialty', value: porter.specialty || '—', inline: true },
            { name: 'Likes', value: `${porter.likes_count || 0} 👍`, inline: true },
            { name: 'Completed Jobs', value: String(porter.completed_jobs || 0), inline: true },
            { name: 'Verified', value: porter.rsi_verified ? '✅ Yes' : '❌ No', inline: true },
            { name: 'RSI', value: porter.rsi_handle || '—', inline: true }
          ));

        await customerUser.send({
          content: `A Porter wants to take your job ${job.job_number}. Accept this Porter?`,
          embeds: [profileEmbed],
          components: [twoButtons(`job:accept:${job.job_number}:${porter.id}`, 'Accept', ButtonStyle.Success, `job:deny:${job.job_number}:${porter.id}`, 'Deny', ButtonStyle.Danger)]
        });
      } catch {}
    }

    try {
      const porterUser = await client.users.fetch(porter.discord_id);
      await porterUser.send(`You’ve requested to take **${job.job_number}**. Waiting for customer approval...`);
    } catch {}

    await ix.reply({ content: `Requested to take ${jobNumber}. The customer has been notified.`, ephemeral: true });
    return;
  }

  if (ix.customId.startsWith('job:accept:') || ix.customId.startsWith('job:deny:')) {
    const [, action, jobNumber, porterDbId] = parts;
    const job = getJobFull(jobNumber);
    if (!job) {
      await ix.reply({ content: 'Job not found.', ephemeral: true });
      return;
    }

    const customer = getUserByDiscord(ix.user.id);
    if (!customer || customer.id !== job.customer_id) {
      await ix.reply({ content: 'Only the job poster can accept/deny.', ephemeral: true });
      return;
    }

    if (action === 'accept') {
      setJobPorter(jobNumber, porterDbId);
      setJobStatus(jobNumber, 'ACCEPTED');

      const buttons = twoButtons(`job:complete:${jobNumber}`, 'Complete Job', ButtonStyle.Success, `job:incomplete:${jobNumber}`, 'Job Incomplete', ButtonStyle.Danger);
      const refreshed = getJobFull(jobNumber);
      const embed = jobCard(refreshed);
      let customerMessageId = null;
      let porterMessageId = null;

      try {
        const customerUser = await client.users.fetch(customer.discord_id);
        const sent = await customerUser.send({ content: `You accepted **${jobNumber}**.`, embeds: [embed], components: [buttons] });
        customerMessageId = sent.id;
      } catch {}

      try {
        const porter = getUserById(porterDbId);
        if (porter) {
          const porterUser = await client.users.fetch(porter.discord_id);
          const sent = await porterUser.send({ content: `Customer accepted you for **${jobNumber}**.`, embeds: [embed], components: [buttons] });
          porterMessageId = sent.id;
        }
      } catch {}

      setJobCompletionMessages({ jobNumber, customerMessageId, porterMessageId });
      await ix.update({ content: `✅ Accepted for ${jobNumber}.`, components: [] });
    } else {
      setJobStatus(jobNumber, 'OPEN');
      await ix.update({ content: `❌ Denied. Job ${jobNumber} is back open.`, components: [] });
    }
    return;
  }

  if (ix.customId.startsWith('job:complete:') || ix.customId.startsWith('job:incomplete:')) {
    const [, action, jobNumber] = parts;
    const job = getJobFull(jobNumber);
    if (!job) {
      await ix.reply({ content: 'Job not found.', ephemeral: true });
      return;
    }

    const actor = getUserByDiscord(ix.user.id);
    if (!actor) {
      await ix.reply({ content: 'Sign up first.', ephemeral: true });
      return;
    }

    const otherId = actor.id === job.customer_id ? job.porter_id : job.customer_id;
    const otherMessageId = actor.id === job.customer_id
      ? job.completion_porter_message_id
      : job.completion_customer_message_id;

    await ix.update({ components: [] });

    if (otherId) {
      try {
        const other = getUserById(otherId);
        if (other) {
          const otherUser = await client.users.fetch(other.discord_id);
          const dmChannel = await otherUser.createDM();
          if (otherMessageId) {
            try {
              const msg = await dmChannel.messages.fetch(otherMessageId);
              await msg.edit({ components: [] });
            } catch {}
          }
          await dmChannel.send(`The other party has acted on **${jobNumber}**. ${TICKET_DM}`);
        }
      } catch {}
    }

    clearJobCompletionMessages(jobNumber);

    if (action === 'complete') {
      setJobStatus(jobNumber, 'COMPLETED');

      const reviewerId = job.customer_id;
      const reviewedId = job.porter_id;
      const canCollectFeedback = reviewerId && reviewedId;
      const feedbackRow = canCollectFeedback
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`feedback:like:${job.id}:${reviewerId}:${reviewedId}:PORTER`)
              .setStyle(ButtonStyle.Success)
              .setLabel('👍 Like'),
            new ButtonBuilder()
              .setCustomId(`feedback:dislike:${job.id}:${reviewerId}:${reviewedId}:PORTER`)
              .setStyle(ButtonStyle.Danger)
              .setLabel('👎 Dislike')
          )
        : null;

      const feedbackPrompt = `✅ Marked **${jobNumber}** as complete. Share how it went with a Like or Dislike (dislikes stay private).`;

      if (actor.id === reviewerId) {
        await ix.followUp({
          content: canCollectFeedback ? feedbackPrompt : `✅ Marked **${jobNumber}** as complete.`,
          components: feedbackRow ? [feedbackRow] : []
        });
      } else {
        await ix.followUp({ content: `✅ Marked **${jobNumber}** as complete.` });

        if (feedbackRow) {
          try {
            const customer = getUserById(reviewerId);
            if (customer) {
              const customerUser = await client.users.fetch(customer.discord_id);
              await customerUser.send({
                content: feedbackPrompt,
                components: [feedbackRow]
              });
            }
          } catch {}
        }
      }
    } else {
      setJobStatus(jobNumber, 'DISPUTED');
      await ix.followUp({ content: `🚨 Marked **${jobNumber}** as incomplete. An admin will review.` });

      if (ADMIN_CHANNEL_ID) {
        try {
          const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
          const embed = jobCard(job);
          await ch.send({ content: `🚨 Dispute opened for **${jobNumber}**`, embeds: [embed] });
        } catch {}
      }
    }
    return;
  }

  if (ix.customId.startsWith('feedback:')) {
    const [_, action, jobId, reviewerId, reviewedId, reviewedRole] = parts;
    const actor = getUserByDiscord(ix.user.id);
    if (!actor || actor.id !== reviewerId) {
      await ix.reply({ content: 'This feedback request is not for you.', ephemeral: true });
      return;
    }

    const liked = action === 'like';
    addFeedback({ jobId, reviewerId, reviewedId, liked });
    refreshUserFeedback(reviewedId);
    if (reviewedRole === 'PORTER') {
      incrementCompletedJobs(reviewedId);
    }

    await ix.update({
      content: liked
        ? '👍 Thanks! Your Like has been recorded.'
        : '👎 Thanks! Your Dislike has been recorded privately.',
      components: []
    });
    return;
  }

  if (ix.customId === 'profile:editbio') {
    const u = getUserByDiscord(ix.user.id);
    if (!u) {
      await ix.reply({ content: 'Register first with `/signup`.', ephemeral: true });
      return;
    }
    await ix.showModal(editProfileModal());
    return;
  }

  if (ix.customId.startsWith('profile:switch:')) {
    const newRole = parts[2];
    const u = getUserByDiscord(ix.user.id);
    if (!u) {
      await ix.reply({ content: 'Register first with `/signup`.', ephemeral: true });
      return;
    }
    if (u.user_type === newRole) {
      await ix.reply({ content: `You are already a **${newRole}**.`, ephemeral: true });
      return;
    }

    updateUserType({ discordId: ix.user.id, userType: newRole });
    await ix.update({ components: [roleSwitchRow(newRole)] });
  }
}

async function handleModalSubmit(ix) {
  if (ix.customId.startsWith('signup:modal:')) {
    const role = ix.customId.split(':')[2];
    const rsiHandle = ix.fields.getTextInputValue('rsi')?.trim() || null;
    const bio = ix.fields.getTextInputValue('bio')?.trim() || null;
    const language = ix.fields.getTextInputValue('lang')?.trim() || null;

    if (role === 'CUSTOMER') {
      upsertUser({ discordId: ix.user.id, username: ix.user.username, userType: 'CUSTOMER', rsiHandle, bio, language });
      await ix.reply({ content: 'Signup completed as **Customer**.', ephemeral: true });
      return;
    }

    upsertUser({ discordId: ix.user.id, username: ix.user.username, userType: 'PORTER', rsiHandle, bio, language });
    await ix.reply({
      content: 'Choose your specialty:',
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('signup:specialty')
          .setPlaceholder('Choose')
          .addOptions(SPECIALTIES.map(s => ({ label: s, value: s })))
      )],
      ephemeral: true
    });
    return;
  }

  if (ix.customId === 'profile:modal:edit') {
    const bio = ix.fields.getTextInputValue('bio')?.trim() || null;
    updateUserBio({ discordId: ix.user.id, bio });
    await ix.reply({ content: 'Profile updated.', ephemeral: true });
    return;
  }

  if (ix.customId.startsWith('postjob:modal:')) {
    const category = ix.customId.split(':')[2];
    const loc = ix.fields.getTextInputValue('loc')?.trim();
    const pay = parseInt(ix.fields.getTextInputValue('pay')?.trim() || '0', 10);
    const desc = ix.fields.getTextInputValue('desc')?.trim();
    const date = ix.fields.getTextInputValue('date')?.trim();

    const u = getUserByDiscord(ix.user.id);
    if (!u) {
      await ix.reply({ content: 'Register first with `/signup`.', ephemeral: true });
      return;
    }

    const job = createJob({ category, customerId: u.id, location: loc, payment: pay, description: desc, dateNeeded: date });

    await ix.reply({
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

client.on('interactionCreate', async (ix) => {
  try {
    if (ix.isChatInputCommand()) {
      await handleChatInputCommand(ix);
      return;
    }

    if (ix.isStringSelectMenu()) {
      await handleSelectMenu(ix);
      return;
    }

    if (ix.isButton()) {
      await handleButtonInteraction(ix);
      return;
    }

    if (ix.type === InteractionType.ModalSubmit) {
      await handleModalSubmit(ix);
    }
  } catch (err) {
    console.error(err);
    if (typeof ix.isRepliable === 'function' && ix.isRepliable()) {
      try {
        await ix.reply({ content: 'Something went wrong. Try again.', ephemeral: true });
      } catch {}
    }
  }
});

client.login(TOKEN);
