const { ContainerBuilder, Events, MessageFlags } = require('discord.js');

// const sailorsLodgeReminder = `
// **/party create** — Post a lobby card so others can join *(optional)*
// **/party lfg** — Ping the Looking for Group role to find players
// **/help** — See all commands
// -# Want more hosting power? Become a Trusted Host → <#1443678567824097310>
// `;

const autoMessages = [
  // {
  //   channelIds: [
  //     "1488339624580354279",
  //     "1488282445630537798",
  //     "1488338738055741480",
  //     "1488283242305159228",
  //     "1488338966385004635",
  //     "1478565020194443265",
  //   ],
  //   intervalMinutes: 360,
  //   message: {
  //     components: [
  //       new ContainerBuilder()
  //         .setAccentColor(0x2f80ed)
  //         .addTextDisplayComponents((textDisplay) => textDisplay.setContent(sailorsLodgeReminder)),
  //     ],
  //     flags: MessageFlags.IsComponentsV2,
  //   },
  // },
];

async function sendAutoMessage(client, autoMessage) {
	try {
		for (const channelId of autoMessage.channelIds) {
			const channel = await client.channels.fetch(channelId);

			if (!channel?.isTextBased()) {
				console.error(`Auto message channel ${channelId} is not text-based.`);
				continue;
			}
		
			await channel.send(autoMessage.message);
		}
	} catch (error) {
		console.error("Failed to send auto message:", error);
	}
}

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		for (const autoMessage of autoMessages) {
			setInterval(
				() => sendAutoMessage(client, autoMessage),
				autoMessage.intervalMinutes * 60 * 1000
			);
		}
	},
};
