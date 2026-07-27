const { EmbedBuilder, MessageFlags } = require('discord.js');

const CONVERSATION_WINDOW_MS = 5_000;
const channelActivity = new Map();
const stickyTimers = new Map();
const channelQueues = new Map();

function timerKey(sticky) {
	return `${sticky.guild_id}:${sticky.id}`;
}

function enqueue(channelId, task) {
	const previous = channelQueues.get(channelId) || Promise.resolve();
	const next = previous.catch(() => undefined).then(task);
	channelQueues.set(channelId, next);
	void next.then(() => {
		if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
	}, () => {
		if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
	});
	return next;
}

function buildPayload(sticky) {
	const payload = sticky.payload || {};
	const embeds = (payload.embeds || []).map((embedData) => {
		const embed = EmbedBuilder.from(embedData);
		const originalFooter = embedData.footer?.text?.trim();
		const stickyFooter = `Sticky message #${sticky.id}`;
		const footerText = originalFooter
			? `${originalFooter.slice(0, 2_045 - stickyFooter.length)} • ${stickyFooter}`
			: stickyFooter;
		embed.setFooter({
			text: footerText,
			iconURL: embedData.footer?.icon_url,
		});
		embed.setTimestamp();
		return embed;
	});
	const files = (payload.files || []).map((file) => ({
		attachment: file.url,
		name: file.name,
	}));

	return {
		content: payload.content || undefined,
		components: payload.components || [],
		embeds,
		files,
		flags: payload.components?.length > 0 ? MessageFlags.IsComponentsV2 : undefined,
		allowedMentions: { parse: [] },
	};
}

async function fetchChannel(client, sticky) {
	const channel = await client.channels.fetch(sticky.channel_id);
	if (!channel?.isTextBased() || !channel.isSendable()) {
		throw new Error(`Sticky #${sticky.id} is assigned to a channel I cannot send to.`);
	}
	return channel;
}

async function deleteDiscordMessage(channel, messageId) {
	if (!messageId) return;
	try {
		const message = await channel.messages.fetch(messageId);
		await message.delete();
	}
	catch (error) {
		if (error.code !== 10008) throw error;
	}
}

async function sendSticky(client, sticky) {
	const database = client.modules.database;
	const current = await database.getStickyMessage(sticky.guild_id, sticky.id);
	if (!current) return null;
	const channel = await fetchChannel(client, current);
	await deleteDiscordMessage(channel, current.message_id);
	const message = await channel.send(buildPayload(current));
	const updated = await database.setStickyDiscordMessage(
		current.guild_id,
		current.id,
		current.channel_id,
		message.id,
	);
	if (!updated) await message.delete().catch(() => undefined);
	return updated;
}

async function resend(client, sticky) {
	return enqueue(sticky.channel_id, () => sendSticky(client, sticky));
}

async function resendChannel(client, guildId, channelId) {
	return enqueue(channelId, async () => {
		const database = client.modules.database;
		const stickies = await database.getStickyMessages(guildId, channelId);
		const channel = stickies.length > 0 ? await fetchChannel(client, stickies[0]) : null;
		if (!channel) return [];

		for (const sticky of stickies) {
			await deleteDiscordMessage(channel, sticky.message_id);
		}

		const sent = [];
		for (const sticky of stickies) {
			const message = await channel.send(buildPayload(sticky));
			const updated = await database.setStickyDiscordMessage(
				guildId,
				sticky.id,
				channelId,
				message.id,
			);
			if (updated) sent.push(updated);
			else await message.delete().catch(() => undefined);
		}
		return sent;
	});
}

function cancel(sticky) {
	const key = timerKey(sticky);
	const timer = stickyTimers.get(key);
	if (timer) clearTimeout(timer);
	stickyTimers.delete(key);
}

function schedule(client, sticky, delay) {
	cancel(sticky);
	const key = timerKey(sticky);
	const timer = setTimeout(() => {
		stickyTimers.delete(key);
		void resend(client, sticky).catch((error) => {
			console.error(`Failed to resend sticky #${sticky.id}:`, error);
		});
	}, delay);
	stickyTimers.set(key, timer);
}

async function handleMessage(message) {
	if (!message.guild || message.author.bot) return;
	const stickies = await message.client.modules.database.getStickyMessages(
		message.guild.id,
		message.channel.id,
	);
	if (stickies.length === 0) return;

	const key = `${message.guild.id}:${message.channel.id}`;
	const now = Date.now();
	const activity = channelActivity.get(key) || {
		lastMessageAt: 0,
		conversation: false,
	};
	if (activity.lastMessageAt && now - activity.lastMessageAt <= CONVERSATION_WINDOW_MS) {
		activity.conversation = true;
	}
	activity.lastMessageAt = now;
	channelActivity.set(key, activity);

	for (const sticky of stickies) {
		const delay = activity.conversation
			? CONVERSATION_WINDOW_MS + sticky.conversation_delay_ms
			: sticky.interval_ms;
		schedule(message.client, sticky, delay);
	}

	const resetAfter = CONVERSATION_WINDOW_MS + Math.max(
		...stickies.map((sticky) => sticky.conversation_delay_ms),
	);
	setTimeout(() => {
		if (channelActivity.get(key)?.lastMessageAt === now) channelActivity.delete(key);
	}, resetAfter);
}

module.exports = {
	buildPayload,
	cancel,
	handleMessage,
	resend,
	resendChannel,
};
