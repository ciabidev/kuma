const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGODB_URI;
const databaseName = process.env.DEV_MODE === "true" ? "development" : "production";

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
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  if (!connectionPromise) {
    client = new MongoClient(uri, {
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

      // The previous single-server schema used a globally unique case ID.
      await Promise.all([
        dropLegacyIndex(cases, "id_1"),
        dropLegacyIndex(cases, "target_user_1_id_-1"),
      ]);

      await Promise.all([
        cases.createIndex({ guild_id: 1, id: 1 }, { unique: true }),
        cases.createIndex({ guild_id: 1, target_user: 1, id: -1 }),
      ]);

      return { database, cases, counters, guildSettings };
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

async function pingDatabase() {
  const { database } = await connectDatabase();
  await database.command({ ping: 1 });
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
  pingDatabase,
  closeDatabase,
};
