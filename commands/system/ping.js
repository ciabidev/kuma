const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder().setName('ping').setDescription('check if kuma and its db are ok'),
	async execute(interaction) {
		await interaction.client.modules.db.pingDb();
		await interaction.reply('hi');
	},
};
