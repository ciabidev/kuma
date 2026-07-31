const { MongoClient, ServerApiVersion } = require("mongodb");
const { environment, mongoUri } = require("#config");

const databaseName = environment;

let client;
let connectionPromise;
const settingsCache = new Map();

async function dropLegacyIndex(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (error) {
    if (!["IndexNotFound", "NamespaceNotFound"].includes(error.codeName)) throw error;
  }
}

async function connectDatabase() {
  if (!connectionPromise) {
    client = new MongoClient(mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    connectionPromise = (async () => {
      await client.connect();

      const database = client.db(databaseName);
      const cases = database.collection("moderation_cases");
      const counters = database.collection("counters");
      const guildSettings = database.collection("guild_settings");
      const stickyMessages = database.collection("sticky_messages");

      // The previous single-server schema used a globally unique case ID.
      await Promise.all([
        dropLegacyIndex(cases, "id_1"),
        dropLegacyIndex(cases, "target_user_1_id_-1"),
      ]);

      await Promise.all([
        cases.createIndex({ guild_id: 1, id: 1 }, { unique: true }),
        cases.createIndex({ guild_id: 1, target_user: 1, id: -1 }),
        stickyMessages.createIndex({ guild_id: 1, id: 1 }, { unique: true }),
        stickyMessages.createIndex({ guild_id: 1, channel_id: 1, order: 1 }),
        stickyMessages.createIndex({ guild_id: 1, sync_source_id: 1 }),
      ]);

      return { database, cases, counters, guildSettings, stickyMessages };
    })().catch(async (error) => {
      await client.close();
      client = undefined;
      connectionPromise = undefined;
      throw error;
    });
  }

  return connectionPromise;
}

async function getUserPoints(guildId, userId) {
  const { cases } = await connectDatabase();
  const [result] = await cases
    .aggregate([
      {
        $match: {
          guild_id: String(guildId),
          target_user: String(userId),
          points_delta: { $ne: null },
        },
      },
      { $group: { _id: null, total: { $sum: "$points_delta" } } },
    ])
    .toArray();

  return result?.total || 0;
}

async function createCase(entry) {
  if (!entry.guild_id) throw new Error("guild_id is required when creating a moderation case");

  const { cases, counters } = await connectDatabase();
  const guildId = String(entry.guild_id);
  const counterId = `moderation_cases:${guildId}`;
  const latestCase = await cases.findOne(
    { guild_id: guildId },
    { sort: { id: -1 }, projection: { id: 1 } }
  );

  await counters.updateOne(
    { _id: counterId },
    { $max: { value: latestCase?.id || 0 } },
    { upsert: true }
  );

  const counter = await counters.findOneAndUpdate(
    { _id: counterId },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );

  const moderationCase = {
    ...entry,
    id: counter.value,
    guild_id: guildId,
    target_user: String(entry.target_user),
    actioned_by: String(entry.actioned_by),
    created_at: new Date(),
  };

  await cases.insertOne(moderationCase);
  return moderationCase;
}

async function getCases(guildId, userId) {
  const { cases } = await connectDatabase();
  return cases
    .find(
      { guild_id: String(guildId), target_user: String(userId) },
      { projection: { _id: 0 } }
    )
    .sort({ id: -1 })
    .toArray();
}

async function getGuildSettings(guildId) {
  const key = String(guildId);
  if (settingsCache.has(key)) return settingsCache.get(key);

  const { guildSettings } = await connectDatabase();
  const settings = (await guildSettings.findOne({ _id: key })) || { _id: key };
  settingsCache.set(key, settings);
  return settings;
}

async function setGuildChannel(guildId, setting, channelId) {
  const allowedSettings = ["modlogs_channel_id", "whirlpool_channel_id"];
  if (!allowedSettings.includes(setting)) {
    throw new Error(`Unsupported guild channel setting: ${setting}`);
  }

  const key = String(guildId);
  const { guildSettings } = await connectDatabase();
  const update = channelId
    ? { $set: { [setting]: String(channelId) } }
    : { $unset: { [setting]: "" } };

  const settings = await guildSettings.findOneAndUpdate(
    { _id: key },
    update,
    { upsert: true, returnDocument: "after" }
  );
  settingsCache.set(key, settings);
  return settings;
}

async function setGuildJoinRole(guildId, roleId) {
  const key = String(guildId);
  const { guildSettings } = await connectDatabase();
  const update = roleId
    ? { $set: { join_role_id: String(roleId) } }
    : { $unset: { join_role_id: "" } };

  const settings = await guildSettings.findOneAndUpdate(
    { _id: key },
    update,
    { upsert: true, returnDocument: "after" }
  );
  settingsCache.set(key, settings);
  return settings;
}

async function pingDatabase() {
  const { database } = await connectDatabase();
  await database.command({ ping: 1 });
}

async function getNextStickyId(counters, stickyMessages, guildId) {
  const counterId = `sticky_messages:${guildId}`;
  const latestSticky = await stickyMessages.findOne(
    { guild_id: guildId },
    { sort: { id: -1 }, projection: { id: 1 } }
  );
  await counters.updateOne(
    { _id: counterId },
    { $max: { value: latestSticky?.id || 0 } },
    { upsert: true }
  );
  const counter = await counters.findOneAndUpdate(
    { _id: counterId },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return counter.value;
}

async function createStickyMessage(entry) {
  const { counters, stickyMessages } = await connectDatabase();
  const guildId = String(entry.guild_id);
  const channelId = String(entry.channel_id);
  const id = await getNextStickyId(counters, stickyMessages, guildId);
  const lastSticky = await stickyMessages.findOne(
    { guild_id: guildId, channel_id: channelId },
    { sort: { order: -1 }, projection: { order: 1 } }
  );
  const sticky = {
    ...entry,
    id,
    type: "sticky",
    guild_id: guildId,
    channel_id: channelId,
    order: (lastSticky?.order || 0) + 1,
    message_id: entry.message_id ? String(entry.message_id) : null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await stickyMessages.insertOne(sticky);
  return sticky;
}

async function createStickyTemplate(entry) {
  const { counters, stickyMessages } = await connectDatabase();
  const guildId = String(entry.guild_id);
  const id = await getNextStickyId(counters, stickyMessages, guildId);
  const template = {
    ...entry,
    id,
    type: "template",
    guild_id: guildId,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await stickyMessages.insertOne(template);
  return template;
}

async function getStickyMessage(guildId, id) {
  const { stickyMessages } = await connectDatabase();
  return stickyMessages.findOne(
    { guild_id: String(guildId), id: Number(id) },
    { projection: { _id: 0 } }
  );
}

async function getStickyMessages(guildId, channelId = null) {
  const { stickyMessages } = await connectDatabase();
  const query = { guild_id: String(guildId), type: { $ne: "template" } };
  if (channelId) query.channel_id = String(channelId);
  return stickyMessages.find(query, { projection: { _id: 0 } })
    .sort({ channel_id: 1, order: 1, id: 1 })
    .toArray();
}

async function getStickyTemplates(guildId) {
  const { stickyMessages } = await connectDatabase();
  return stickyMessages.find(
    { guild_id: String(guildId), type: "template" },
    { projection: { _id: 0 } }
  ).sort({ id: 1 }).toArray();
}

async function updateStickyMessage(guildId, id, update) {
  const { stickyMessages } = await connectDatabase();
  const allowed = [
    "channel_id",
    "conversation_delay_ms",
    "cloned_from_id",
    "interval_ms",
    "message_id",
    "order",
    "payload",
    "sync_source_id",
    "sync_with_source",
    "template_id",
  ];
  const fields = Object.fromEntries(
    Object.entries(update).filter(([key]) => allowed.includes(key))
  );
  fields.updated_at = new Date();
  return stickyMessages.findOneAndUpdate(
    { guild_id: String(guildId), id: Number(id) },
    { $set: fields },
    { returnDocument: "after", projection: { _id: 0 } }
  );
}

async function syncStickyClones(guildId, sourceId, payload) {
  const { stickyMessages } = await connectDatabase();
  const query = {
    guild_id: String(guildId),
    sync_source_id: Number(sourceId),
    sync_with_source: true,
    type: { $ne: "template" },
  };
  await stickyMessages.updateMany(
    query,
    { $set: { payload, updated_at: new Date() } }
  );
  return stickyMessages.find(query, { projection: { _id: 0 } }).toArray();
}

async function stopStickySync(guildId, id) {
  const { stickyMessages } = await connectDatabase();
  return stickyMessages.findOneAndUpdate(
    { guild_id: String(guildId), id: Number(id) },
    {
      $set: { sync_with_source: false, updated_at: new Date() },
      $unset: { sync_source_id: "" },
    },
    { returnDocument: "after", projection: { _id: 0 } }
  );
}

async function setStickyDiscordMessage(guildId, id, channelId, messageId) {
  const { stickyMessages } = await connectDatabase();
  return stickyMessages.findOneAndUpdate(
    {
      guild_id: String(guildId),
      id: Number(id),
      channel_id: String(channelId),
    },
    { $set: { message_id: String(messageId), updated_at: new Date() } },
    { returnDocument: "after", projection: { _id: 0 } }
  );
}

async function deleteStickyMessage(guildId, id) {
  const { stickyMessages } = await connectDatabase();
  const deleted = await stickyMessages.findOneAndDelete(
    { guild_id: String(guildId), id: Number(id) },
    { projection: { _id: 0 } }
  );
  if (deleted) {
    await stickyMessages.updateMany(
      { guild_id: String(guildId), sync_source_id: Number(id) },
      {
        $set: { sync_with_source: false, updated_at: new Date() },
        $unset: { sync_source_id: "" },
      }
    );
  }
  return deleted;
}

async function reorderStickyMessages(guildId, channelId, orderedIds) {
  const { stickyMessages } = await connectDatabase();
  if (orderedIds.length === 0) return;
  await stickyMessages.bulkWrite(orderedIds.map((id, index) => ({
    updateOne: {
      filter: {
        guild_id: String(guildId),
        channel_id: String(channelId),
        id: Number(id),
      },
      update: { $set: { order: index + 1, updated_at: new Date() } },
    },
  })));
}

async function closeDatabase() {
  if (connectionPromise) {
    await client.close();
    client = undefined;
    connectionPromise = undefined;
    settingsCache.clear();
  }
}

module.exports = {
  connectDatabase,
  getUserPoints,
  createCase,
  getCases,
  getGuildSettings,
  setGuildChannel,
  setGuildJoinRole,
  pingDatabase,
  createStickyMessage,
  createStickyTemplate,
  getStickyMessage,
  getStickyMessages,
  getStickyTemplates,
  updateStickyMessage,
  syncStickyClones,
  stopStickySync,
  setStickyDiscordMessage,
  deleteStickyMessage,
  reorderStickyMessages,
  closeDatabase,
};
