const { Events, MessageFlags } = require("discord.js");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const client = interaction.client;

    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: "This bot's commands can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        let content = error.message;
        if (error.stack) {
          content += `\n\n${error.stack}`;
        }

        if (error.code === 50001) {
          content = "I don't have access to this channel, or I can't send messages to this user.";
        }
      
          const replyContent = {
            content: `An error occurred while executing this command, please report this to us via our [issue board](https://github.com/ciabidev/kuma/issues)\n\`\`\`${content}\`\`\``,
            flags: [MessageFlags.Ephemeral],
          };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyContent);
        } else {
          await interaction.reply(replyContent);
        }
      }
    }
  },
};
