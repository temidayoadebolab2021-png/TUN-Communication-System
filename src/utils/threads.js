// Helper that finds (or creates) the dedicated Discord thread for a nation.
// Every recruit gets their own thread so conversations don't get mixed up.

const db = require('../database');

/**
 * Cleans a string so it's safe to use as a Discord thread name.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/**
 * Returns the thread for a recruit, creating it if it doesn't exist yet.
 * `client` is the Discord bot client, `nationId`/`nationName` identify the recruit.
 */
async function getOrCreateRecruitThread(client, nationId, nationName) {
  const recruit = db.getRecruit(nationId);

  const logChannelId = db.getMailLogChannelId();
  if (!logChannelId) {
    throw new Error('Mail log channel is not configured. Use /config mail-log-channel set or set MAIL_LOG_CHANNEL_ID in your .env file.');
  }

  const logChannel = await client.channels.fetch(logChannelId);

  // If we already have a thread saved, try to reuse it.
  if (recruit && recruit.discord_thread_id) {
    try {
      const existingThread = await client.channels.fetch(recruit.discord_thread_id);
      if (existingThread) return existingThread;
    } catch {
      // Thread might have been deleted manually - fall through and make a new one.
    }
  }

  const threadName = `recruit-${nationId}-${slugify(nationName)}`;

  const thread = await logChannel.threads.create({
    name: threadName,
    autoArchiveDuration: 10080, // 7 days
    reason: `Recruitment conversation for nation #${nationId}`,
  });

  db.upsertRecruit(nationId, {
    nation_name: nationName,
    discord_thread_id: thread.id,
  });

  return thread;
}

module.exports = { getOrCreateRecruitThread, slugify };
