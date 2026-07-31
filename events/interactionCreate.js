const { Events, MessageFlags } = require("discord.js");
const { issuesUrl } = require("#config");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const client = interaction.client;

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error("Failed to provide autocomplete choices:", error);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("sticky:")) {
      try {
        await client.modules.stickyInteractions.handleModal(interaction);
      } catch (error) {
        await replyWithError(interaction, error);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("sticky:")) {
      try {
        await client.modules.stickyInteractions.handleButton(interaction);
      } catch (error) {
        await replyWithError(interaction, error);
      }
      return;
    }

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
        await replyWithError(interaction, error);
      }
    }
  },
};

async function replyWithError(interaction, error) {
  console.error(error);
  let content = error.message;
  if (error.code === 50001) {
    content = "I don't have access to that channel.";
  }
  const issuePrompt = issuesUrl ? `\nReport persistent issues here: ${issuesUrl}` : "";
  const replyContent = {
    content: `An error occurred: ${content}${issuePrompt}`,
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(replyContent);
  } else {
    await interaction.reply(replyContent);
  }
}
