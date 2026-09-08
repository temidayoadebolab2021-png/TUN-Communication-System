// Discord hard-caps any single message at 2000 characters. Mail bodies can
// easily be longer than that (especially templates with a lot of detail),
// so every place that posts a mail body into a Discord channel/thread must
// run it through this first, or Discord will reject the whole message.

const DISCORD_MAX_LENGTH = 2000;

/**
 * Safely fits `text` (optionally with a prefix like "**Message:**\n") under
 * Discord's 2000 character limit, trimming the END of the text and adding a
 * note if anything had to be cut off.
 */
function truncateForDiscord(text, prefix = '') {
  const suffix = '\n...(message truncated - see full text in PnW mail history)';
  const available = DISCORD_MAX_LENGTH - prefix.length;

  if (prefix.length + text.length <= DISCORD_MAX_LENGTH) {
    return prefix + text;
  }

  const trimmedText = text.slice(0, Math.max(available - suffix.length, 0));
  return prefix + trimmedText + suffix;
}

module.exports = { truncateForDiscord, DISCORD_MAX_LENGTH };
