const { Events } = require('discord.js');

module.exports = {
	name: Events.GuildMemberAdd,
	async execute(member) {
		let settings;
		try {
			settings = await member.client.modules.database.getGuildSettings(member.guild.id);
		}
		catch (error) {
			console.error('Failed to load join-role settings:', error);
			return;
		}

		if (!settings.join_role_id) {
			return;
		}

		const role = member.guild.roles.cache.get(settings.join_role_id);
		if (!role || !role.editable) {
			console.error(`Cannot assign join role ${settings.join_role_id} in guild ${member.guild.id}.`);
			return;
		}

		try {
			await member.roles.add(role, 'Configured join role');
		}
		catch (error) {
			console.error(`Failed to assign join role in guild ${member.guild.id}:`, error);
		}
	},
};
