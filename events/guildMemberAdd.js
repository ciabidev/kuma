const { Events } = require("discord.js");

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const CHANNEL_ID = "1393752798625140757";
    const WELCOME_ROLE_ID = "1481829069422067712";
    const VERIFY_CHANNEL_ID = "1393748197117005958";
    const channel = member.guild.channels.cache.get(CHANNEL_ID);

    if (!channel) return;
    await channel.send(
      `<@&${WELCOME_ROLE_ID}> ➡️ Welcome ${member} to Sunfish Village! Please verify in <#${VERIFY_CHANNEL_ID}> to gain access to the rest of the server.

- New to beast hunting or parties? Check out <#1478922526749888562>
- Anyone can host a party using **/party lfg** — no approval needed!
- Want to ping specific roles? Apply for Trusted Host in <#1443678567824097310>`,
    );
  },
};