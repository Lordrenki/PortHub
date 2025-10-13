import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { CLIENT_ID, GUILD_ID, TOKEN, CATEGORIES } from './config.js';

// Slash commands definition
const commands = [
  new SlashCommandBuilder()
    .setName('signup')
    .setDescription('Register as a Porter or Customer and set your profile.'),
  new SlashCommandBuilder()
    .setName('postjob')
    .setDescription('Post a job (Customers only).'),
  new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Browse open jobs.'),
  new SlashCommandBuilder()
    .setName('viewjob')
    .setDescription('View a job by number.')
    .addStringOption(o => o.setName('jobnumber').setDescription('e.g., JOB-1234').setRequired(true)),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your or someone else’s profile.')
    .addUserOption(o => o.setName('user').setDescription('User to view')),
  new SlashCommandBuilder()
    .setName('topporters')
    .setDescription('Show top Porters.')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function run() {
  if (process.argv[2] === 'guild' && GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Registered GUILD commands.');
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Registered GLOBAL commands. (Can take up to an hour to appear.)');
  }
}
run().catch(console.error);
