const { Events } = require("discord.js");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.id === message.client.user.id) return;

    try {
      await message.client.modules.stickyMessages.handleMessage(message);
    } catch (error) {
      console.error("Failed to process sticky messages:", error);
    }

    let settings;
    try {
      settings = await message.client.modules.database.getGuildSettings(message.guild.id);
    } catch (error) {
      console.error("Failed to load guild settings:", error);
      return;
    }
    if (message.channel.id === settings.whirlpool_channel_id) {
      await message.delete();

      try {
        await message.guild.members.ban(message.author.id, {
          reason: "Spam bot detected",
          deleteMessageSeconds: 604800,
        });
      } catch (err) {
        console.error(
          `${message.author.username} survived the whirlpool and was not banned: `,
          err
        );
      }
    }
  },
};
