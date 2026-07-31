const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  Collection,
} = require("discord.js");

const fs = require("node:fs");

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName("moderation")
      .setDescription("Moderation commands")
      .setDMPermission(false);

    const dir = __dirname; // commands/moderation
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".js") && file !== "main.js");

    for (const file of files) {
      const sub = require(`#commands/moderation/${file.slice(0, -3)}`);
      builder.addSubcommand(() => sub.data);
    }

    return builder;
  })(),

  async execute(interaction) {
    const name = interaction.options.getSubcommand(true);
    const handler = require(`#commands/moderation/${name}`);
    return handler.execute(interaction);
  },
};
