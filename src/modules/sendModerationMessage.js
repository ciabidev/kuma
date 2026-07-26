// send a moderation message embed to the channel the command was used in

const { ContainerBuilder, MessageFlags } = require("discord.js");
const { getGuildSettings } = require("./database");

module.exports = async function sendModerationMessage({
  targetUser, // user object
  action, // string
  reason = "No reason provided",
  actionedBy, // user object
  interaction, // interaction object
  durationMs = null, 
  pointsDelta = null, 
  caseId,
}) {
  const dateUnix = Math.floor(new Date(interaction.createdAt).getTime() / 1000);
  const formattedDuration = interaction.client.modules.formatMilliseconds(durationMs);
  const mainText = new ContainerBuilder()
    .addTextDisplayComponents(
      (t) => t.setContent(`### ${action} | case #${caseId}`),
      (t) => t.setContent(`${action} to <@${targetUser.id}> (${targetUser.id}) by <@${actionedBy.id}> (${actionedBy.id})\n`),
      (t) => t.setContent(`**Reason: **${reason ? reason : "No reason provided"}\n`),
      ...(durationMs ? [(t) => t.setContent(`**Duration: **${formattedDuration}\n`)] : [])
    )

    .addTextDisplayComponents(
      ...(pointsDelta
        ? [
            (t) =>
              t.setContent(`**Point Change:** ${pointsDelta > 0 ? "+" : ""}${pointsDelta}\n`),
          ]
        : [])
    )

    .addSeparatorComponents((separator) => separator)


    .addTextDisplayComponents(
      (t) => t.setContent(`-# <t:${dateUnix}:R>`),
    );
    
  const components = [mainText];

  if (interaction) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ components, flags: MessageFlags.IsComponentsV2 });
    } else {
      await interaction.reply({ components, flags: MessageFlags.IsComponentsV2 });
    }
  } 

  const { modlogs_channel_id: modlogsChannelId } = await getGuildSettings(interaction.guildId);
  if (modlogsChannelId && modlogsChannelId !== interaction.channelId) {
    try {
      const modlogsChannel = await interaction.guild.channels.fetch(modlogsChannelId);
      await modlogsChannel.send({
        components,
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      console.error(`Failed to send moderation message to modlogs channel: ${error}`);
    }
  }
};
