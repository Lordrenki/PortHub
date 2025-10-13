import 'dotenv/config';

// Bot credentials
export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
export const GUILD_ID = process.env.DISCORD_GUILD_ID || ''; // Optional for faster testing
export const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID || ''; // Optional: dispute reports

// Master admin (only this ID can delete profiles)
export const MASTER_ADMIN_ID = '1395110823898255442';

// Job board settings
export const JOBS_PAGE_SIZE = 10; // Jobs shown per page in /jobs

// Supported job categories
export const CATEGORIES = [
  'Cargo',
  'Bounties',
  'FPS Combat',
  'Air Combat',
  'Trading',
  'Salvaging'
];

// Same list used for porter specialties
export const SPECIALTIES = [...CATEGORIES];

// Text sent if someone’s job buttons were disabled and they might need admin help
export const TICKET_DM = `If something went sideways, please join our Discord and open a ticket so an admin can help.`;
