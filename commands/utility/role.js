const {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} = require('discord.js');

function addRoleOption(subcommand, description = 'The role to manage') {
	return subcommand.addRoleOption((option) =>
		option.setName('role').setDescription(description).setRequired(true),
	);
}

function getRoleError(interaction, role) {
	if (role.id === interaction.guild.id) {
		return 'The @everyone role cannot be managed.';
	}
	if (role.managed) {
		return `${role} is managed by an integration and cannot be changed manually.`;
	}
	if (!role.editable) {
		return `I cannot manage ${role}. Move my highest role above it and give me Manage Roles permission.`;
	}

	const member = interaction.member;
	const isOwner = interaction.guild.ownerId === member.id;
	if (!isOwner && member.roles.highest.comparePositionTo(role) <= 0) {
		return `You cannot manage ${role} because it is equal to or above your highest role.`;
	}

	return null;
}

function getMemberError(interaction, member) {
	if (!member.manageable) {
		return 'I cannot manage that user because their highest role is equal to or above mine.';
	}
	if (interaction.guild.ownerId === interaction.member.id) {
		return null;
	}
	if (member.id === interaction.member.id) {
		return null;
	}
	if (member.id === interaction.guild.ownerId) {
		return 'You cannot manage the server owner.';
	}
	if (interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
		return 'You cannot manage that user because their highest role is equal to or above yours.';
	}
	return null;
}

async function updateMembers(members, update) {
	let changed = 0;
	let skipped = 0;
	let failed = 0;
	const queue = [...members.values()];

	for (let index = 0; index < queue.length; index += 10) {
		const results = await Promise.allSettled(queue.slice(index, index + 10).map(update));
		for (const result of results) {
			if (result.status === 'rejected') {
				failed += 1;
			}
			else if (result.value) {
				changed += 1;
			}
			else {
				skipped += 1;
			}
		}
	}

	return { changed, failed, skipped };
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('role')
		.setDescription('Manage server roles')
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.setDMPermission(false)
		.addSubcommand((subcommand) =>
			addRoleOption(
				subcommand.setName('humans').setDescription('Add or remove a role for all human users'),
			).addBooleanOption((option) =>
				option
					.setName('remove')
					.setDescription('Remove the role instead of adding it')
					.setRequired(false),
			),
		)
		.addSubcommand((subcommand) =>
			addRoleOption(
				subcommand.setName('bots').setDescription('Add or remove a role for all bots'),
			).addBooleanOption((option) =>
				option
					.setName('remove')
					.setDescription('Remove the role instead of adding it')
					.setRequired(false),
			),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName('removeall')
				.setDescription('Remove every removable role from a user')
				.addUserOption((option) =>
					option.setName('user').setDescription('The user to remove roles from').setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName('joinrole')
				.setDescription('Set or remove the role given to new members')
				.addRoleOption((option) =>
					option
						.setName('role')
						.setDescription('The role to give new members')
						.setRequired(false),
				)
				.addBooleanOption((option) =>
					option
						.setName('remove')
						.setDescription('Remove the configured join role')
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			addRoleOption(
				subcommand
					.setName('in')
					.setDescription('Toggle a role for every member with another role')
					.addRoleOption((option) =>
						option
							.setName('in_role')
							.setDescription('Only update members with this role')
							.setRequired(true),
					),
				'The role to toggle',
			),
		)
		.addSubcommand((subcommand) =>
			addRoleOption(
				subcommand
					.setName('add')
					.setDescription('Add a role to one user')
					.addUserOption((option) =>
						option.setName('user').setDescription('The user to update').setRequired(true),
					),
			),
		)
		.addSubcommand((subcommand) =>
			addRoleOption(
				subcommand
					.setName('remove')
					.setDescription('Remove a role from one user')
					.addUserOption((option) =>
						option.setName('user').setDescription('The user to update').setRequired(true),
					),
			),
		),

	async execute(interaction) {
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
			await interaction.reply({
				content: 'You need Manage Roles permission to use this command.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const subcommand = interaction.options.getSubcommand(true);

		if (subcommand === 'joinrole') {
			const remove = interaction.options.getBoolean('remove') ?? false;
			if (remove) {
				await interaction.client.modules.database.setGuildJoinRole(interaction.guildId, null);
				await interaction.reply({
					content: 'The join role has been removed.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const role = interaction.options.getRole('role');
			if (!role) {
				await interaction.reply({
					content: 'Choose a role, or set `remove` to true.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const roleError = getRoleError(interaction, role);
			if (roleError) {
				await interaction.reply({ content: roleError, flags: MessageFlags.Ephemeral });
				return;
			}

			await interaction.client.modules.database.setGuildJoinRole(interaction.guildId, role.id);
			await interaction.reply({
				content: `New members will receive ${role}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (subcommand === 'removeall') {
			const member = interaction.options.getMember('user');
			if (!member) {
				await interaction.reply({
					content: 'That user is no longer in this server.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const memberError = getMemberError(interaction, member);
			if (memberError) {
				await interaction.reply({
					content: memberError,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const isOwner = interaction.guild.ownerId === interaction.member.id;
			const roles = member.roles.cache.filter((role) =>
				role.id !== interaction.guildId
				&& !role.managed
				&& role.editable
				&& (isOwner || interaction.member.roles.highest.comparePositionTo(role) > 0),
			);
			if (roles.size > 0) {
				await member.roles.remove([...roles.keys()], `All roles removed by ${interaction.user.tag}`);
			}
			await interaction.reply({
				content: `Removed ${roles.size} role${roles.size === 1 ? '' : 's'} from ${member}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const role = interaction.options.getRole('role', true);
		const roleError = getRoleError(interaction, role);
		if (roleError) {
			await interaction.reply({ content: roleError, flags: MessageFlags.Ephemeral });
			return;
		}

		if (subcommand === 'add' || subcommand === 'remove') {
			const member = interaction.options.getMember('user');
			if (!member) {
				await interaction.reply({
					content: 'That user is no longer in this server.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const memberError = getMemberError(interaction, member);
			if (memberError) {
				await interaction.reply({
					content: memberError,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const remove = subcommand === 'remove';
			const alreadyCorrect = remove
				? !member.roles.cache.has(role.id)
				: member.roles.cache.has(role.id);
			if (alreadyCorrect) {
				await interaction.reply({
					content: `${member} ${remove ? 'does not have' : 'already has'} ${role}.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (remove) {
				await member.roles.remove(role, `Role removed by ${interaction.user.tag}`);
			}
			else {
				await member.roles.add(role, `Role added by ${interaction.user.tag}`);
			}
			await interaction.reply({
				content: `${remove ? 'Removed' : 'Added'} ${role} ${remove ? 'from' : 'to'} ${member}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const members = await interaction.guild.members.fetch();

		if (subcommand === 'humans' || subcommand === 'bots') {
			const bots = subcommand === 'bots';
			const remove = interaction.options.getBoolean('remove') ?? false;
			const targets = members.filter((member) => member.user.bot === bots);
			const results = await updateMembers(targets, async (member) => {
				const memberError = getMemberError(interaction, member);
				if (memberError) {
					throw new Error(memberError);
				}
				const hasRole = member.roles.cache.has(role.id);
				if (remove === !hasRole) {
					return false;
				}
				if (remove) {
					await member.roles.remove(role, `Bulk role removal by ${interaction.user.tag}`);
				}
				else {
					await member.roles.add(role, `Bulk role addition by ${interaction.user.tag}`);
				}
				return true;
			});
			let resultMessage = `${remove ? 'Removed' : 'Added'} ${role} ${remove ? 'from' : 'to'} ${targets.size} ${bots ? 'bots' : 'humans'}: ${results.changed} changed`;
			if (results.skipped > 0) {
				resultMessage += `, ${results.skipped} already correct`;
			}
			if (results.failed > 0) {
				resultMessage += `, ${results.failed} failed`;
			}
			await interaction.editReply(`${resultMessage}.`);
			return;
		}

		if (subcommand === 'in') {
			const inRole = interaction.options.getRole('in_role', true);
			const targets = members.filter((member) => member.roles.cache.has(inRole.id));
			const results = await updateMembers(targets, async (member) => {
				const memberError = getMemberError(interaction, member);
				if (memberError) {
					throw new Error(memberError);
				}
				if (member.roles.cache.has(role.id)) {
					await member.roles.remove(role, `Role toggled by ${interaction.user.tag}`);
				}
				else {
					await member.roles.add(role, `Role toggled by ${interaction.user.tag}`);
				}
				return true;
			});
			let resultMessage = `Toggled ${role} for ${targets.size} members with ${inRole}: ${results.changed} changed`;
			if (results.failed > 0) {
				resultMessage += `, ${results.failed} failed`;
			}
			await interaction.editReply(`${resultMessage}.`);
			return;
		}

		await interaction.editReply('Unknown role subcommand.');
	},
};
