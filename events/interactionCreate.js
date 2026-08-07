const { Events, MessageFlags, PermissionFlagsBits } = require("discord.js");
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

    if (typeof interaction.customId === "string" && interaction.customId.startsWith("role:")) {
      const action = interaction.customId.split(":")[1];
      if (interaction.isModalSubmit()) {
        switch (action) {
          case "joinroles": {
            try {
              if (!interaction.inGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
                await interaction.reply({
                  content: "You need Manage Roles permission to configure join roles.",
                  flags: MessageFlags.Ephemeral,
                });
                return;
              }

              const roleIds = [...interaction.fields.getSelectedRoles("joinroles", true).keys()];
              const roles = roleIds.map((roleId) => interaction.guild.roles.cache.get(roleId));
              if (roles.some((role) => !role)) {
                await interaction.reply({
                  content: "One or more selected roles no longer exist in this server.",
                  flags: MessageFlags.Ephemeral,
                });
                return;
              }

              for (const role of roles) {
                if (role.id === interaction.guild.id) {
                  await interaction.reply({
                    content: "The @everyone role cannot be managed.",
                    flags: MessageFlags.Ephemeral,
                  });
                  return;
                }
                if (role.managed) {
                  await interaction.reply({
                    content: `${role} is managed by an integration and cannot be changed manually.`,
                    flags: MessageFlags.Ephemeral,
                  });
                  return;
                }
                if (!role.editable) {
                  await interaction.reply({
                    content: `I cannot manage ${role}. Move my highest role above it and give me Manage Roles permission.`,
                    flags: MessageFlags.Ephemeral,
                  });
                  return;
                }

                if (interaction.guild.ownerId !== interaction.member.id
                  && interaction.member.roles.highest.comparePositionTo(role) <= 0) {
                  await interaction.reply({
                    content: `You cannot manage ${role} because it is equal to or above your highest role.`,
                    flags: MessageFlags.Ephemeral,
                  });
                  return;
                }
              }

              await interaction.client.modules.db.setGuildJoinRoles(interaction.guildId, roleIds);
              await interaction.reply({
                content: `New members will receive ${roles.join(", ")}.`,
                flags: MessageFlags.Ephemeral,
              });
            } catch (error) {
              await replyWithError(interaction, error);
            }
            return;
          }
        }
      }
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
