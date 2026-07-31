const registerSubcommandFolder = require("#modules/subcommandFolder");

module.exports = registerSubcommandFolder({
  name: "moderation",
  description: "Moderation commands",
  dirname: __dirname,
  configure: (builder) => builder.setDMPermission(false),
});
