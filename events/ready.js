const { ActivityType, Events } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		const updateStatus = async () => {
			const guilds = await Promise.all(client.guilds.cache.map((guild) =>
				client.guilds.fetch({ guild: guild.id, withCounts: true }),
			));
			const memberCount = guilds.reduce(
				(total, guild) => total + (guild.approximateMemberCount ?? guild.memberCount),
				0,
			);
			client.user.setActivity(`Protecting ${memberCount.toLocaleString('en-US')} members`, {
				type: ActivityType.Custom,
			});
		};

		await updateStatus();
		setInterval(() => void updateStatus().catch(console.error), 60 * 60 * 1_000).unref();
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};
