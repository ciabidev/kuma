const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder().setName('ping').setDescription('check if kuma and its database are ok'),
	async execute(interaction) {
		await interaction.client.modules.database.pingDatabase();
		await interaction.reply('hi');
	},
};
