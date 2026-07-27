const {
	ActionRowBuilder,
	ChannelType,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
} = require('discord.js');

const DEFAULT_COLOR = '#89b4fa';
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_CONVERSATION_DELAY_MS = 10_000;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

function addTimingOptions(subcommand) {
	return subcommand
		.addStringOption((option) => option
			.setName('interval')
			.setDescription('Delay after a single message (default: 1m)'),
		)
		.addStringOption((option) => option
			.setName('conversation_delay')
			.setDescription('Delay after a conversation ends (default: 10s)'),
		)
		.addChannelOption((option) => option
			.setName('channel')
			.setDescription('Channel for the sticky (default: this channel)')
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
		);
}

function parseDuration(value, fallback, label) {
	if (!value) return fallback;
	const match = String(value).trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
	if (!match) throw new Error(`${label} must be a duration such as \`10s\`, \`1m\`, or \`2h\`.`);
	const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
	const milliseconds = Number(match[1]) * multipliers[match[2]];
	if (milliseconds < MIN_INTERVAL_MS || milliseconds > MAX_INTERVAL_MS) {
		throw new Error(`${label} must be between 1 second and 7 days.`);
	}
	return milliseconds;
}

function getChannelError(interaction, channel) {
	if (!channel?.isTextBased() || !channel.isSendable()) return 'Choose a channel where messages can be sent.';
	const permissions = channel.permissionsFor(interaction.guild.members.me);
	const required = [
		PermissionFlagsBits.ViewChannel,
		PermissionFlagsBits.SendMessages,
		PermissionFlagsBits.ManageMessages,
		PermissionFlagsBits.EmbedLinks,
	];
	if (!permissions?.has(required)) {
		return `I need View Channel, Send Messages, Manage Messages, and Embed Links in ${channel}.`;
	}
	return null;
}

function modalRow(input) {
	return new ActionRowBuilder().addComponents(input);
}

function createModal(customId, values = {}) {
	return new ModalBuilder()
		.setCustomId(customId)
		.setTitle(values.modalTitle || (values.id ? `Edit sticky #${values.id}` : 'Create sticky message'))
		.addComponents(
			modalRow(new TextInputBuilder()
				.setCustomId('title')
				.setLabel('Title (optional)')
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
				.setMaxLength(256)
				.setValue(values.title || ''),
			),
			modalRow(new TextInputBuilder()
				.setCustomId('description')
				.setLabel('Description')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setMaxLength(4_000)
				.setValue(values.description || ''),
			),
			modalRow(new TextInputBuilder()
				.setCustomId('color')
				.setLabel('Sidebar color')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setMinLength(7)
				.setMaxLength(7)
				.setValue(values.color || DEFAULT_COLOR),
			),
			modalRow(new TextInputBuilder()
				.setCustomId('footer')
				.setLabel('Footer (optional)')
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
				.setMaxLength(1_900)
				.setValue(values.footer || ''),
			),
		);
}

async function payloadFromMessageLink(interaction, link) {
	const match = String(link).trim().match(
		/^https?:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/,
	);
	if (!match || match[1] !== interaction.guildId) {
		throw new Error('Use a message link from this server.');
	}
	const channel = await interaction.guild.channels.fetch(match[2]);
	if (!channel?.isTextBased()) throw new Error('The linked message is not in a text channel.');
	const message = await channel.messages.fetch(match[3]);
	const disableInteractiveComponents = (components) => components.map((component) => {
		const copy = structuredClone(component);
		if (copy.custom_id) copy.disabled = true;
		if (copy.components) copy.components = disableInteractiveComponents(copy.components);
		if (copy.accessory) [copy.accessory] = disableInteractiveComponents([copy.accessory]);
		return copy;
	});
	const components = message.flags.has(MessageFlags.IsComponentsV2)
		? disableInteractiveComponents(message.components.map((component) => component.toJSON()))
		: [];
	const firstComponentText = (items) => {
		for (const item of items) {
			if (item.content) return item.content;
			const nested = item.components || (item.accessory ? [item.accessory] : []);
			const text = firstComponentText(nested);
			if (text) return text;
		}
		return '';
	};
	const payload = {
		content: message.content || undefined,
		embeds: message.embeds.map((embed) => embed.toJSON()),
		component_text: firstComponentText(components), // this is used for the sticky message preview, doesnt show anything on discord
		components,
		files: message.attachments.map((attachment) => ({
			name: attachment.name,
			url: attachment.url,
		})),
	};
	if (
		!payload.content
		&& payload.embeds.length === 0
		&& payload.files.length === 0
		&& payload.components.length === 0
	) {
		throw new Error('That message has no content I can copy.');
	}
	return payload;
}

function stickySummary(sticky, guild) {
	const firstText = sticky.payload?.embeds?.[0]?.title
		|| sticky.payload?.embeds?.[0]?.description
		|| sticky.payload?.content
		|| sticky.payload?.component_text
		|| sticky.payload?.files?.[0]?.name
		|| 'Attachment';
	const channel = guild.channels.cache.get(sticky.channel_id);
	const location = sticky.type === 'template'
		? 'Template'
		: channel ? `#${channel.name}` : `channel ${sticky.channel_id}`;
	const clone = sticky.cloned_from_id
		? ` • Clone of #${sticky.cloned_from_id}${sticky.sync_with_source ? ' ↻' : ''}`
		: '';
	return `${location} • #${sticky.id}${clone} • ${firstText.replace(/\s+/g, ' ').slice(0, 45)}`.slice(0, 100);
}

const data = new SlashCommandBuilder()
	.setName('sticky')
	.setDescription('Manage utility sticky messages')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
	.setDMPermission(false)
	.addSubcommand((subcommand) => addTimingOptions(subcommand
		.setName('create')
		.setDescription('Create a sticky from a message link or an embed form')
		.addStringOption((option) => option
			.setName('message_link')
			.setDescription('Copy an existing Discord message'),
		)
		.addStringOption((option) => option
			.setName('template')
			.setDescription('Create from a saved sticky template')
			.setAutocomplete(true),
		)))
	.addSubcommand((subcommand) => addTimingOptions(subcommand
		.setName('edit')
		.setDescription('Edit a sticky')
		.addStringOption((option) => option
			.setName('sticky')
			.setDescription('Sticky to edit')
			.setRequired(true)
			.setAutocomplete(true),
		)
		.addStringOption((option) => option
			.setName('message_link')
			.setDescription('Replace its payload with an existing Discord message'),
		)))
	.addSubcommand((subcommand) => addTimingOptions(subcommand
		.setName('clone')
		.setDescription('Clone an existing sticky message')
		.addStringOption((option) => option
			.setName('sticky')
			.setDescription('Sticky to clone')
			.setRequired(true)
			.setAutocomplete(true),
		)
		.addBooleanOption((option) => option
			.setName('sync')
			.setDescription('Keep the clone payload synced with the original'),
		)))
	.addSubcommand((subcommand) => subcommand
		.setName('template')
		.setDescription('Create a reusable sticky template without sending it')
		.addStringOption((option) => option
			.setName('message_link')
			.setDescription('Copy an existing Discord message'),
		))
	.addSubcommand((subcommand) => subcommand
		.setName('delete')
		.setDescription('Delete a sticky')
		.addStringOption((option) => option
			.setName('sticky')
			.setDescription('Sticky to delete')
			.setRequired(true)
			.setAutocomplete(true),
		))
	.addSubcommand((subcommand) => subcommand
		.setName('reorder')
		.setDescription('Reorder all sticky messages in a channel')
		.addChannelOption((option) => option
			.setName('channel')
			.setDescription('Channel to reorder (default: this channel)')
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
		));

async function execute(interaction) {
	if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
		await interaction.reply({
			content: 'You need Manage Messages permission to manage stickies.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const subcommand = interaction.options.getSubcommand(true);
	const database = interaction.client.modules.database;
	if (subcommand === 'template') {
		const messageLink = interaction.options.getString('message_link');
		if (!messageLink) {
			await interaction.showModal(createModal('sticky:template', {
				modalTitle: 'Create sticky template',
			}));
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const payload = await payloadFromMessageLink(interaction, messageLink);
		const template = await database.createStickyTemplate({
			guild_id: interaction.guildId,
			payload,
			created_by: interaction.user.id,
		});
		await interaction.editReply(`Created sticky template #${template.id}.`);
		return;
	}

	if (subcommand === 'create') {
		const channel = interaction.options.getChannel('channel') || interaction.channel;
		const channelError = getChannelError(interaction, channel);
		if (channelError) {
			await interaction.reply({ content: channelError, flags: MessageFlags.Ephemeral });
			return;
		}
		const interval = parseDuration(
			interaction.options.getString('interval'),
			DEFAULT_INTERVAL_MS,
			'Interval',
		);
		const conversationDelay = parseDuration(
			interaction.options.getString('conversation_delay'),
			DEFAULT_CONVERSATION_DELAY_MS,
			'Conversation delay',
		);
		const messageLink = interaction.options.getString('message_link');
		const templateId = interaction.options.getString('template');
		if (messageLink && templateId) {
			await interaction.reply({
				content: 'Choose either a message link or a template, not both.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!messageLink && !templateId) {
			await interaction.showModal(createModal(
				`sticky:create:${channel.id}:${interval}:${conversationDelay}`,
			));
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const template = templateId
			? await database.getStickyMessage(interaction.guildId, Number(templateId))
			: null;
		if (templateId && template?.type !== 'template') {
			await interaction.editReply('That sticky template no longer exists.');
			return;
		}
		const payload = template
			? structuredClone(template.payload)
			: await payloadFromMessageLink(interaction, messageLink);
		if (payload.files?.length > 0 && !channel.permissionsFor(interaction.guild.members.me)
			.has(PermissionFlagsBits.AttachFiles)) {
			await interaction.editReply(`I need Attach Files permission in ${channel} to copy that message.`);
			return;
		}
		const sticky = await interaction.client.modules.stickyInteractions.createSticky(interaction, {
			channelId: channel.id,
			conversationDelay,
			interval,
			payload,
			templateId: template?.id,
		});
		await interaction.editReply(`Created sticky #${sticky.id} in ${channel}.`);
		return;
	}

	if (subcommand === 'clone') {
		const sourceId = Number(interaction.options.getString('sticky', true));
		const source = await database.getStickyMessage(interaction.guildId, sourceId);
		if (!source || source.type === 'template') {
			await interaction.reply({
				content: 'That sticky no longer exists.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const channel = interaction.options.getChannel('channel') || interaction.channel;
		const channelError = getChannelError(interaction, channel);
		if (channelError) {
			await interaction.reply({ content: channelError, flags: MessageFlags.Ephemeral });
			return;
		}
		const interval = parseDuration(
			interaction.options.getString('interval'),
			source.interval_ms,
			'Interval',
		);
		const conversationDelay = parseDuration(
			interaction.options.getString('conversation_delay'),
			source.conversation_delay_ms,
			'Conversation delay',
		);
		const sync = interaction.options.getBoolean('sync') || false;
		if (source.payload?.files?.length > 0 && !channel.permissionsFor(interaction.guild.members.me)
			.has(PermissionFlagsBits.AttachFiles)) {
			await interaction.reply({
				content: `I need Attach Files permission in ${channel} to clone that sticky.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const sticky = await interaction.client.modules.stickyInteractions.createSticky(interaction, {
			channelId: channel.id,
			clonedFromId: source.id,
			conversationDelay,
			interval,
			payload: structuredClone(source.payload),
			syncSourceId: sync ? source.sync_source_id || source.id : null,
			syncWithSource: sync,
		});
		await interaction.editReply(
			`Cloned sticky #${source.id} as #${sticky.id} in ${channel}${sync ? ' with sync enabled' : ''}.`,
		);
		return;
	}

	if (subcommand === 'edit') {
		const id = Number(interaction.options.getString('sticky', true));
		const sticky = await database.getStickyMessage(interaction.guildId, id);
		if (!sticky) {
			await interaction.reply({ content: 'That sticky no longer exists.', flags: MessageFlags.Ephemeral });
			return;
		}
		const messageLink = interaction.options.getString('message_link');
		const embed = sticky.payload?.embeds?.[0];
		if (sticky.type === 'template') {
			if (!messageLink) {
				await interaction.showModal(createModal(`sticky:edit_template:${id}`, {
					id: sticky.id,
					modalTitle: `Edit template #${sticky.id}`,
					title: embed?.title || '',
					description: embed?.description || sticky.payload?.content || '',
					color: embed?.color
						? `#${embed.color.toString(16).padStart(6, '0')}`
						: DEFAULT_COLOR,
					footer: embed?.footer?.text || '',
				}));
				return;
			}

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const payload = await payloadFromMessageLink(interaction, messageLink);
			await interaction.client.modules.stickyInteractions.updatePayload(
				interaction,
				sticky,
				payload,
			);
			await interaction.editReply(`Updated sticky template #${sticky.id}.`);
			return;
		}
		const channel = interaction.options.getChannel('channel')
			|| await interaction.guild.channels.fetch(sticky.channel_id);
		const channelError = getChannelError(interaction, channel);
		if (channelError) {
			await interaction.reply({ content: channelError, flags: MessageFlags.Ephemeral });
			return;
		}
		const interval = parseDuration(
			interaction.options.getString('interval'),
			sticky.interval_ms,
			'Interval',
		);
		const conversationDelay = parseDuration(
			interaction.options.getString('conversation_delay'),
			sticky.conversation_delay_ms,
			'Conversation delay',
		);
		if (messageLink) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const payload = await payloadFromMessageLink(interaction, messageLink);
			if (payload.files.length > 0 && !channel.permissionsFor(interaction.guild.members.me)
				.has(PermissionFlagsBits.AttachFiles)) {
				await interaction.editReply(`I need Attach Files permission in ${channel} to copy that message.`);
				return;
			}
			const targetStickies = sticky.channel_id === channel.id
				? []
				: await database.getStickyMessages(interaction.guildId, channel.id);
			const order = sticky.channel_id === channel.id
				? sticky.order
				: targetStickies.reduce((maximum, item) => Math.max(maximum, item.order), 0) + 1;
			const updated = await interaction.client.modules.stickyInteractions.updatePayload(
				interaction,
				sticky,
				payload,
				{
					channel_id: channel.id,
					conversation_delay_ms: conversationDelay,
					interval_ms: interval,
					message_id: sticky.channel_id === channel.id ? sticky.message_id : null,
					order,
				},
			);
			interaction.client.modules.stickyMessages.cancel(sticky);
			if (sticky.channel_id !== channel.id && sticky.message_id) {
				const oldChannel = await interaction.guild.channels.fetch(sticky.channel_id).catch(() => null);
				const oldMessage = oldChannel?.isTextBased()
					? await oldChannel.messages.fetch(sticky.message_id).catch(() => null)
					: null;
				if (oldMessage?.deletable) await oldMessage.delete();
			}
			await interaction.editReply(`Updated sticky #${updated.id} in ${channel}.`);
			return;
		}
		await interaction.showModal(createModal(
			`sticky:edit:${id}:${channel.id}:${interval}:${conversationDelay}`,
			{
				id: sticky.id,
				title: embed?.title || '',
				description: embed?.description || sticky.payload?.content || '',
				color: embed?.color
					? `#${embed.color.toString(16).padStart(6, '0')}`
					: DEFAULT_COLOR,
				footer: embed?.footer?.text || '',
			},
		));
		return;
	}

	if (subcommand === 'delete') {
		const id = Number(interaction.options.getString('sticky', true));
		const sticky = await database.deleteStickyMessage(interaction.guildId, id);
		if (!sticky) {
			await interaction.reply({ content: 'That sticky no longer exists.', flags: MessageFlags.Ephemeral });
			return;
		}
		if (sticky.type === 'template') {
			await interaction.reply({
				content: `Deleted sticky template #${sticky.id}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		interaction.client.modules.stickyMessages.cancel(sticky);
		const channel = await interaction.guild.channels.fetch(sticky.channel_id).catch(() => null);
		const message = channel?.isTextBased() && sticky.message_id
			? await channel.messages.fetch(sticky.message_id).catch(() => null)
			: null;
		if (message?.deletable) await message.delete();
		await interaction.reply({
			content: `Deleted sticky #${sticky.id}.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const channel = interaction.options.getChannel('channel') || interaction.channel;
	const channelError = getChannelError(interaction, channel);
	if (channelError) {
		await interaction.reply({ content: channelError, flags: MessageFlags.Ephemeral });
		return;
	}
	const stickies = await database.getStickyMessages(interaction.guildId, channel.id);
	if (stickies.length < 2) {
		await interaction.reply({
			content: `There ${stickies.length === 1 ? 'is only one sticky' : 'are no stickies'} in ${channel}.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	await interaction.reply({
		components: interaction.client.modules.stickyInteractions.buildReorderComponents(
			stickies,
			channel.id,
		),
		flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
	});
}

async function autocomplete(interaction) {
	const database = interaction.client.modules.database;
	const focused = interaction.options.getFocused(true);
	const subcommand = interaction.options.getSubcommand(true);
	const [stickies, templates] = await Promise.all([
		database.getStickyMessages(interaction.guildId),
		database.getStickyTemplates(interaction.guildId),
	]);
	const records = focused.name === 'template'
		? templates
		: subcommand === 'clone' ? stickies : [...stickies, ...templates];
	const query = focused.value.toLowerCase();
	const choices = records
		.map((sticky) => ({
			name: stickySummary(sticky, interaction.guild),
			value: String(sticky.id),
		}))
		.filter((choice) => choice.name.toLowerCase().includes(query) || choice.value.includes(query))
		.slice(0, 25);
	await interaction.respond(choices);
}

module.exports = {
	autocomplete,
	data,
	execute,
};
