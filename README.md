# kuma
Discord moderation bot with isolated settings, cases, and point totals for every server.

Its not public rn so you'll have to self host it:

# How to self host

## 1. Clone the repo

1. Clone the repo

2. Install the dependencies with `npm install`
    - make sure you have node installed (latest)

## 2. Configure environment variables

Copy the variables from `.env.example` into your hosting provider's environment configuration.

- `ENVIRONMENT`: `development` or `production`; this is also the MongoDB database name.
- `DISCORD_TOKEN`: the token for the bot used by this deployment.
- `DEV_IDS`: comma-separated Discord user IDs allowed to run developer-only commands.
- `MONGO_URI`: your MongoDB Atlas connection string.
- `ISSUES`: optional URL shown when a command fails so users can report the problem.

### MongoDB Atlas

1. Create a free Atlas cluster and a database user.
2. Add your hosting provider's outbound IP to Atlas Network Access. For local development, add your current IP.
3. In Atlas, select Connect -> Drivers -> Node.js and copy the connection string.
4. Set `MONGO_URI` to that connection string and replace its username and password placeholders.
The bot uses the database named by `ENVIRONMENT` and creates its collections and indexes automatically.

Moderation cases created by an older single-server version do not have a `guild_id` and are intentionally hidden to prevent cross-server data leaks. Add the original server's ID to those documents in Atlas if you want to retain them.

### discord
Create a bot in https://discord.com/developers/applications.
1. On the Bot page, enable the Server Members and Message Content privileged gateway intents.
2. In the Installation tab, enable the `bot` and `applications.commands` scopes and grant the moderation permissions you intend to use.
3. go to your discord settings and enable developer mode

Set `DISCORD_TOKEN` to the token from the bot's Bot page. The application ID is read from the logged-in bot session, and commands are deployed globally to every server that installs the bot.

### Per-server configuration

Members with Manage Server permission can configure channels independently in each server:

- `/config set-channel purpose:Moderation logs` sends a copy of moderation actions to that channel.
- `/config set-channel purpose:Spam-bot whirlpool` deletes messages in that channel and bans their authors.
- `/config clear-channel` disables either feature.
- `/config view` shows the current server's settings.

The whirlpool is disabled by default. Only enable it in a dedicated trap channel.

## 3. Deploying
- cloudflare and vercel will not work with this, you'll have to use something like Render or Koyeb etc. 

### Render
render is free i found a funny loophole
Do not have multiple web services under a single workspace or you'll hit usage limit fast
1. create a new workspace
2. create a web service and import from your cloned github repo
3. set build command to `npm install` and start command to `npm start`
4. scroll to the environment section and add the required variables
5. deploy


### for other services
Haven't had much experience with others so here's a general guide:
1. import from github
2. add the required environment variables
3. set build command to `npm install` and start command to `npm start`
4. deploy
## Development
Run `npm run dev`. Commands are deployed globally whenever the bot starts.

# Commands

## Moderation

- cases
- kick
- removepoints
- removetimeout
- punish
- unban

## Utility

- purge

## System

- ping
- reload


