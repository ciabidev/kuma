const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const channelSettings = {
  modlogs: "modlogs_channel_id",
  whirlpool: "whirlpool_channel_id",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure this server's bot settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-channel")
        .setDescription("Set a channel used by the bot")
        .addStringOption((option) =>
          option
            .setName("purpose")
            .setDescription("How the channel will be used")
            .setRequired(true)
            .addChoices(
              { name: "Moderation logs", value: "modlogs" },
              { name: "Spam-bot whirlpool", value: "whirlpool" }
            )
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("The channel to use")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear-channel")
        .setDescription("Disable a configured channel")
        .addStringOption((option) =>
          option
            .setName("purpose")
            .setDescription("The channel setting to clear")
            .setRequired(true)
            .addChoices(
              { name: "Moderation logs", value: "modlogs" },
              { name: "Spam-bot whirlpool", value: "whirlpool" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("view").setDescription("View this server's configured channels")
    ),

  async execute(interaction) {

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "You need Manage Server permission to configure the bot.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const subcommand = interaction.options.getSubcommand(true);
    const database = interaction.client.modules.database;

    if (subcommand === "view") {
      const settings = await database.getGuildSettings(interaction.guildId);
      const modlogs = settings.modlogs_channel_id
        ? `<#${settings.modlogs_channel_id}>`
        : "Not configured";
      const whirlpool = settings.whirlpool_channel_id
        ? `<#${settings.whirlpool_channel_id}>`
        : "Disabled";

      return interaction.reply({
        content: `**Moderation logs:** ${modlogs}\n**Spam-bot whirlpool:** ${whirlpool}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const purpose = interaction.options.getString("purpose", true);
    const setting = channelSettings[purpose];

    if (subcommand === "clear-channel") {
      await database.setGuildChannel(interaction.guildId, setting, null);
      return interaction.reply({
        content: `${purpose === "modlogs" ? "Moderation logs" : "Spam-bot whirlpool"} disabled.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "set-channel") {
      const channel = interaction.options.getChannel("channel", true);
      await database.setGuildChannel(interaction.guildId, setting, channel.id);
    }
    return interaction.reply({
      content: `${purpose === "modlogs" ? "Moderation logs" : "Spam-bot whirlpool"} set to ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
