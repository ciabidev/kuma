const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	TextDisplayBuilder,
} = require('discord.js');

function buildReorderComponents(stickies, channelId) {
	const lines = stickies.map((sticky, index) => {
		const clone = sticky.cloned_from_id
			? ` — clone of #${sticky.cloned_from_id}${sticky.sync_with_source ? ' ↻' : ''}`
			: '';
		return `${index + 1}. Sticky #${sticky.id}${clone}`;
	});
	const container = new ContainerBuilder().addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`### Sticky order\n${lines.join('\n')}\n\nUse the arrows to move a sticky. Changes are applied immediately.`,
		),
	);
	const visible = stickies.slice(0, 10);
	for (let index = 0; index < visible.length; index += 2) {
		const row = new ActionRowBuilder();
		for (const sticky of visible.slice(index, index + 2)) {
			row.addComponents(
				new ButtonBuilder()
					.setCustomId(`sticky:move:${channelId}:${sticky.id}:up`)
					.setLabel(`↑ #${sticky.id}`)
					.setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId(`sticky:move:${channelId}:${sticky.id}:down`)
					.setLabel(`↓ #${sticky.id}`)
					.setStyle(ButtonStyle.Secondary),
			);
		}
		container.addActionRowComponents(row);
	}
	return [container];
}

async function createSticky(interaction, values) {
	const db = interaction.client.modules.db;
	const sticky = await db.createStickyMessage({
		guild_id: interaction.guildId,
		channel_id: values.channelId,
		interval_ms: values.interval,
		conversation_delay_ms: values.conversationDelay,
		payload: values.payload,
		created_by: interaction.user.id,
		cloned_from_id: values.clonedFromId || null,
		sync_source_id: values.syncSourceId || null,
		sync_with_source: values.syncWithSource || false,
		template_id: values.templateId || null,
	});
	try {
		return await interaction.client.modules.stickyMessages.resend(interaction.client, sticky);
	}
	catch (error) {
		await db.deleteStickyMessage(interaction.guildId, sticky.id);
		throw error;
	}
}

async function updatePayload(interaction, record, payload, update = {}) {
	const db = interaction.client.modules.db;
	let updated = await db.updateStickyMessage(interaction.guildId, record.id, {
		...update,
		payload,
	});
	if (record.type === 'template') return updated;
	if (record.sync_with_source) updated = await db.stopStickySync(interaction.guildId, record.id);

	const syncedClones = await db.syncStickyClones(interaction.guildId, record.id, payload);
	await Promise.all([updated, ...syncedClones].filter(Boolean).map((sticky) =>
		interaction.client.modules.stickyMessages.resend(interaction.client, sticky),
	));
	return updated;
}

async function handleModal(interaction) {
	if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
		await interaction.reply({
			content: 'You need Manage Messages permission to manage stickies.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const [prefix, action, rawId, channelId, rawInterval, rawConversationDelay] = interaction.customId.split(':');
	if (prefix !== 'sticky') return;
	const title = interaction.fields.getTextInputValue('title').trim();
	const description = interaction.fields.getTextInputValue('description').trim();
	const color = interaction.fields.getTextInputValue('color').trim();
	const footer = interaction.fields.getTextInputValue('footer').trim();
	if (!description) throw new Error('A description is required.');
	if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Sidebar color must look like `#89b4fa`.');

	const embed = new EmbedBuilder()
		.setDescription(description)
		.setColor(Number.parseInt(color.slice(1), 16));
	if (title) embed.setTitle(title);
	if (footer) embed.setFooter({ text: footer });
	const payload = { embeds: [embed.toJSON()] };
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	if (action === 'template') {
		const template = await interaction.client.modules.db.createStickyTemplate({
			guild_id: interaction.guildId,
			payload,
			created_by: interaction.user.id,
		});
		await interaction.editReply(`Created sticky template #${template.id}.`);
		return;
	}

	if (action === 'create') {
		const sticky = await createSticky(interaction, {
			channelId: rawId,
			interval: Number(channelId),
			conversationDelay: Number(rawInterval),
			payload,
		});
		await interaction.editReply(`Created sticky #${sticky.id} in <#${rawId}>.`);
		return;
	}

	const id = Number(rawId);
	const db = interaction.client.modules.db;
	const oldSticky = await db.getStickyMessage(interaction.guildId, id);
	if (!oldSticky) {
		await interaction.editReply('That sticky no longer exists.');
		return;
	}
	if (action === 'edit_template') {
		const template = await updatePayload(interaction, oldSticky, payload);
		await interaction.editReply(`Updated sticky template #${template.id}.`);
		return;
	}
	const targetStickies = oldSticky.channel_id === channelId
		? []
		: await db.getStickyMessages(interaction.guildId, channelId);
	const newOrder = targetStickies.reduce(
		(maximum, sticky) => Math.max(maximum, sticky.order),
		0,
	) + 1;
	const sticky = await updatePayload(interaction, oldSticky, payload, {
		channel_id: channelId,
		conversation_delay_ms: Number(rawConversationDelay),
		interval_ms: Number(rawInterval),
		message_id: oldSticky.channel_id === channelId ? oldSticky.message_id : null,
		order: oldSticky.channel_id === channelId ? oldSticky.order : newOrder,
	});
	interaction.client.modules.stickyMessages.cancel(oldSticky);
	if (oldSticky.channel_id !== channelId && oldSticky.message_id) {
		const oldChannel = await interaction.guild.channels.fetch(oldSticky.channel_id).catch(() => null);
		const oldMessage = oldChannel?.isTextBased()
			? await oldChannel.messages.fetch(oldSticky.message_id).catch(() => null)
			: null;
		if (oldMessage?.deletable) await oldMessage.delete();
	}
	await interaction.editReply(`Updated sticky #${sticky.id} in <#${channelId}>.`);
}

async function handleButton(interaction) {
	if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
		await interaction.reply({
			content: 'You need Manage Messages permission to reorder stickies.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const [, action, channelId, rawId, direction] = interaction.customId.split(':');
	if (action !== 'move') return;
	await interaction.deferUpdate();
	const db = interaction.client.modules.db;
	const stickies = await db.getStickyMessages(interaction.guildId, channelId);
	const index = stickies.findIndex((sticky) => sticky.id === Number(rawId));
	const target = direction === 'up' ? index - 1 : index + 1;
	if (index >= 0 && target >= 0 && target < stickies.length) {
		[stickies[index], stickies[target]] = [stickies[target], stickies[index]];
		await db.reorderStickyMessages(
			interaction.guildId,
			channelId,
			stickies.map((sticky) => sticky.id),
		);
		await interaction.client.modules.stickyMessages.resendChannel(
			interaction.client,
			interaction.guildId,
			channelId,
		);
	}
	const updated = await db.getStickyMessages(interaction.guildId, channelId);
	await interaction.editReply({ components: buildReorderComponents(updated, channelId) });
}

module.exports = {
	buildReorderComponents,
	createSticky,
	handleButton,
	handleModal,
	updatePayload,
};
