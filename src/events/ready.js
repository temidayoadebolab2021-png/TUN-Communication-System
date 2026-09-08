module.exports = {
  // Discord.js is renaming "ready" to "clientReady" in a future version.
  // "clientReady" already works today, so we use it now to avoid the warning.
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`✅ Bot is online in ${client.guilds.cache.size} server(s).`);
  },
};
