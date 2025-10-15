import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} from 'discord.js';

import { CATEGORIES, SPECIALTIES, JOBS_PAGE_SIZE } from './config.js';

// --------------------- PAGINATION CONTROLS ---------------------

export function pageControls(page, totalPages, baseCustomId) {
  const prev = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:prev:${page}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('⬅️ Prev')
    .setDisabled(page <= 1);

  const next = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:next:${page}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ➡️')
    .setDisabled(page >= totalPages);

  return new ActionRowBuilder().addComponents(prev, next);
}

// --------------------- CATEGORY SELECT ---------------------

export function categorySelect(customId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Choose a category')
    .addOptions(CATEGORIES.map(c => ({ label: c, value: c })));
  return new ActionRowBuilder().addComponents(menu);
}

// --------------------- SPECIALTY SELECT ---------------------

export function specialtySelect(customId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Choose a specialty')
    .addOptions(SPECIALTIES.map(s => ({ label: s, value: s })));
  return new ActionRowBuilder().addComponents(menu);
}

// --------------------- DUAL BUTTONS ---------------------

export function twoButtons(idLeft, labelLeft, styleLeft, idRight, labelRight, styleRight) {
  const a = new ButtonBuilder().setCustomId(idLeft).setLabel(labelLeft).setStyle(styleLeft);
  const b = new ButtonBuilder().setCustomId(idRight).setLabel(labelRight).setStyle(styleRight);
  return new ActionRowBuilder().addComponents(a, b);
}

// --------------------- INFO EMBED ---------------------

export function infoEmbed(title, fields) {
  const e = new EmbedBuilder().setTitle(title).setColor(0x00A7E0);
  if (fields) {
    e.addFields(fields.map(([name, value, inline]) => ({
      name,
      value,
      inline: !!inline
    })));
  }
  return e;
}

// --------------------- PORTER-ONLY EMBED ---------------------

export function porterOnlyEmbed() {
  return new EmbedBuilder()
    .setTitle('Porter Only')
    .setDescription('Only registered **Porters** can take jobs. Use `/signup` to register as a Porter.')
    .setColor(0xE67E22);
}

// --------------------- JOB CARD EMBED ---------------------

export function jobCard(job) {
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

// --------------------- PROFILE EMBED ---------------------

export function profileEmbed(user, discordUser) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${user.username} (${user.user_type})`,
      iconURL: discordUser?.displayAvatarURL?.()
    })
    .setColor(0x00A7E0)
    .addFields(
      { name: 'Likes', value: `${user.likes_count || 0} 👍`, inline: true },
      { name: 'Completed Jobs', value: String(user.completed_jobs || 0), inline: true },
      { name: 'RSI Handle', value: user.rsi_handle || '—', inline: true },
      { name: 'Specialty', value: user.specialty || '—', inline: true },
      { name: 'Language', value: user.language || '—', inline: true },
      { name: 'Verified', value: user.rsi_verified ? '✅ Yes' : '❌ No', inline: true },
      { name: 'Bio', value: user.bio || '—' }
    );
  return embed;
}

// --------------------- ROLE SWITCH BUTTONS ---------------------

export function roleSwitchButtons(currentRole) {
  const row = new ActionRowBuilder();

  if (currentRole === 'PORTER') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('profile:switch:CUSTOMER')
        .setLabel('Switch to Customer')
        .setStyle(ButtonStyle.Secondary)
    );
  } else if (currentRole === 'CUSTOMER') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('profile:switch:PORTER')
        .setLabel('Switch to Porter')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return row;
}

// --------------------- EDIT PROFILE BUTTONS ---------------------

export function editProfileButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:edit:bio')
      .setLabel('Edit Bio / RSI / Language')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('profile:edit:specialty')
      .setLabel('Edit Specialty')
      .setStyle(ButtonStyle.Primary)
  );
}
