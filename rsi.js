import axios from 'axios';

/**
 * Checks if a user's RSI profile bio contains the verification code.
 * @param {string} rsiHandle - The RSI handle (username) of the user.
 * @param {string} code - The unique code generated for verification.
 * @returns {Promise<boolean>} - True if the code is found, false otherwise.
 */
export async function rsiBioHasCode(rsiHandle, code) {
  try {
    const url = `https://robertsspaceindustries.com/citizens/${encodeURIComponent(rsiHandle)}`;
    const { data: html } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': 'PortHubBot/1.0' }
    });
    const haystack = (html || '').toLowerCase();
    const needle = (code || '').toLowerCase();
    return haystack.includes(needle);
  } catch (err) {
    console.error('RSI verification check failed:', err.message);
    return false;
  }
}
