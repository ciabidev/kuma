const sendModerationDM = require("#modules/sendModerationDM");
const sendModerationMessage = require("#modules/sendModerationMessage");
const { createCase } = require("#modules/db");

module.exports = async function recordModerationEvent({
  targetUser,
  interaction,
  action,
  reason = "No reason provided",
  actionedBy = interaction.user,
  durationMs = null,
  pointsDelta = null,
  notifyUser = true,
}) {
  const points_delta = pointsDelta

  const moderationCase = await createCase({
    guild_id: interaction.guildId,
    target_user: targetUser.id,
    action,
    reason,
    actioned_by: actionedBy.id,
    duration_ms: durationMs,
    points_delta,
  });

  if (notifyUser) {
    await sendModerationDM({
      targetUser,
      interaction,
      action,
      reason,
      durationMs,
      actionedBy,
      pointsDelta,
    });
  }

  await sendModerationMessage({
    targetUser,
    action,
    reason,
    actionedBy,
    durationMs,
    interaction,
    pointsDelta,
    caseId: moderationCase.id,
  });
  
}
