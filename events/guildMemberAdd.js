const { Events } = require('discord.js');

module.exports = {
	name: Events.GuildMemberAdd,
	async execute(member) {
		let settings;
		try {
			settings = await member.client.modules.db.getGuildSettings(member.guild.id);
		}
		catch (error) {
			console.error('Failed to load join-role settings:', error);
			return;
		}

		const configuredRoleIds = Array.isArray(settings.join_role_ids)
			? [...new Set(settings.join_role_ids.filter(Boolean).map(String))]
			: settings.join_role_id ? [String(settings.join_role_id)] : [];
		if (configuredRoleIds.length === 0) {
			return;
		}

		const roles = configuredRoleIds
			.map((roleId) => member.guild.roles.cache.get(roleId))
			.filter(Boolean);
		const assignableRoles = roles.filter((role) => role.editable);
		if (roles.length !== configuredRoleIds.length || assignableRoles.length !== roles.length) {
			console.error(`Cannot assign one or more configured join roles in guild ${member.guild.id}.`);
		}
		if (assignableRoles.length === 0) {
			return;
		}

		try {
			await member.roles.add(assignableRoles, 'Configured join roles');
		}
		catch (error) {
			console.error(`Failed to assign join roles in guild ${member.guild.id}:`, error);
		}
	},
};
