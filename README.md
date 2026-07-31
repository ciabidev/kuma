# kuma

Kuma is a multi-server Discord moderation bot with isolated settings, moderation cases, and point totals for each server.

## Self-hosting

Kuma uses Discord's Gateway, so it needs a continuously running Node.js process with outbound WebSocket and MongoDB access. Static hosting and function-only serverless platforms cannot run this application unchanged.

### Requirements

- [Git](https://git-scm.com/downloads)
- [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)
- A Discord server where you have Manage Server permission
- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster or compatible MongoDB deployment
- An always-on host for production deployments

### 1. Install Kuma

```sh
git clone https://github.com/ciabidev/kuma.git
cd kuma
npm ci
```

`npm ci` performs a clean install from `package-lock.json`, which makes it preferable to `npm install` for deployments.

### 2. Create and install the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application, and open its **Bot** page.
2. Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**. Kuma requests both intents and Discord will reject the connection if they are disabled.
3. Under **Token**, reset and copy the bot token. Store it securely; never commit or share it.
4. Open **Installation** and enable the **Guild Install** context.
5. Select the **Discord Provided Link**. Under the Guild Install settings, add the `applications.commands` and `bot` scopes.
6. Grant the permissions required by the features you intend to use:
   - View Channels, Send Messages, Embed Links, Attach Files, and Read Message History
   - Manage Messages and Manage Roles
   - Kick Members, Ban Members, and Moderate Members
7. Copy the install link and add the bot to your server.
8. In your server's role settings, move the bot's role above every role and member it needs to manage. Discord does not allow a bot to manage targets above its highest role.

The application ID is obtained from the logged-in bot session. `CLIENT_ID` and `GUILD_ID` environment variables are not needed. Kuma registers its commands globally when it starts, making them available to every server where the bot is installed.

Discord's current setup flow is documented in [Building your first Discord bot](https://docs.discord.com/developers/quick-start/getting-started), with intent details in the [Gateway documentation](https://docs.discord.com/developers/events/gateway).

### 3. Configure MongoDB Atlas

1. Create an Atlas project and cluster.
2. Create a database user with `readWrite` access to the database selected by ENVIRONMENT. [MongoDB should create a user for you when first starting]. Database users are not the same as website users
3. Select **Connect** → **Drivers** → **Node.js** and copy the `mongodb+srv://...` connection string. Replace its username and password placeholders with the username and db password created
4. In **Network Access**, allow the outbound IP address (or CIDR ranges) used by the server hosting Kuma. For local development, add your current public IP.

Kuma creates its collections and indexes automatically. Moderation cases from the old single-server schema do not contain `guild_id` and remain hidden to prevent cross-server data leaks. Add the original server ID to those documents if you need to migrate them.

### 4. Configure environment variables

For local development, copy `.env.example` to `.env`. On a hosting platform, add the same values through its environment or secrets settings.

| Variable | Required | Description |
| --- | --- | --- |
| `ENVIRONMENT` | Yes | `development` or `production`; also used as the MongoDB database name. |
| `DISCORD_TOKEN` | Yes | Bot token from the Discord Developer Portal. Treat it as a secret. |
| `MONGO_URI` | Yes | MongoDB connection string. Treat it as a secret. |
| `DEV_IDS` | No | Comma-separated Discord user IDs permitted to run `/reload`. |
| `ISSUES` | No | Issue tracker URL included in command error responses. |
| `PORT` | No | HTTP health-check port. Defaults to `3000`; hosting platforms usually provide it. |

Enable Developer Mode under Discord **User Settings** → **Advanced**, then use **Copy User ID** to obtain values for `DEV_IDS`.

### 5. Host Kuma on your own machine

After completing the steps above, start Kuma from the project directory:

```sh
npm start
```

This works on Windows, macOS, and Linux. When running Kuma this way, keep the terminal open, the computer awake, and its internet connection active for as long as you want the bot online. Kuma only makes outbound connections to Discord and MongoDB, so you do not need to forward a router port or expose the health endpoint to the internet.

For local development with automatic restarts:

```sh
npm run dev
```

Successful startup logs show the MongoDB connection, Discord login, and global command deployment. The health endpoint is available at `http://localhost:3000/` unless `PORT` is set.

For an always-on installation, use [PM2](https://pm2.keymetrics.io/):

```sh
npm install --global pm2
pm2 start index.js --name kuma
pm2 save
```

PM2 keeps Kuma running after you close the terminal and restarts it if it crashes. Use `pm2 logs kuma` to view its logs and `pm2 restart kuma` after updating the bot.

## Deploying on Render

1. Push your configured fork to GitHub. Do not commit `.env`.
2. In Render, create a **Web Service** from the repository and select the Node runtime.
3. Set the build command to `npm ci --omit=dev`.
4. Set the start command to `npm start`.
5. Add `ENVIRONMENT`, `DISCORD_TOKEN`, `MONGO_URI`, `DEV_IDS`, and optionally `ISSUES` under **Environment**. Render supplies `PORT` automatically.
6. Set the HTTP health-check path to `/`.
7. In the service's **Connect** → **Outbound** tab, copy its outbound CIDR ranges and add them to the Atlas IP access list.
8. Deploy and check the logs for the successful database, Discord, and command-deployment messages.

Render web services support the long-running process and health endpoint Kuma needs. Render's [free web services](https://render.com/docs/free) spin down after 15 minutes without inbound traffic and are not reliable for an always-online Discord bot; use an always-on instance for production. See Render's documentation for [web services](https://render.com/docs/web-services), [health checks](https://render.com/docs/health-checks), and [outbound IP ranges](https://render.com/docs/outbound-ip-addresses).

## Other hosting providers

Use a service that supports a persistent Node.js process and outbound WebSocket and TCP connections. Configure it with:

- Node.js 24
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- The environment variables listed above
- A public HTTP port using the host-provided `PORT`
- An Atlas IP access-list entry for the host's outbound address

Run one Kuma process unless you deliberately add Discord sharding or coordination between replicas.

## Per-server configuration

Members with Manage Server permission can configure each server independently:

- `/config set-channel purpose:Moderation logs` sets the moderation-log channel.
- `/config set-channel purpose:Spam-bot whirlpool` sets a trap channel that deletes messages and bans their authors.
- `/config clear-channel` disables either configured channel.
- `/config view` displays the current settings.

The whirlpool is disabled by default. Enable it only in a dedicated trap channel.

## Commands

- `/moderation cases`
- `/moderation kick`
- `/moderation removepoints`
- `/moderation removetimeout`
- `/moderation punish`
- `/moderation unban`
- `/config`
- `/purge`
- `/role`
- `/sticky`
- `/ping`
- `/reload` — restricted to users listed in `DEV_IDS`

## Troubleshooting

- **Discord reports disallowed intents:** enable Server Members Intent and Message Content Intent on the application's Bot page.
- **MongoDB times out or rejects the connection:** verify `MONGO_URI`, the database user, and the IP access list. For Render, allow every CIDR shown under the service's outbound addresses.
- **Moderation or role actions fail:** verify the bot's permissions, channel overrides, and role position.
- **Slash commands are missing:** confirm the app was installed with `applications.commands` and `bot`, then restart Kuma and check the global-deployment log.
- **The bot goes offline on Render Free:** the service has likely spun down; move it to an always-on instance.
