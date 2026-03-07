import { Client, GatewayIntentBits, Events, TextChannel } from "discord.js";
import * as fs from "fs";
import * as path from "path";

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VIBES_CHANNEL_ID = process.env.DISCORD_VIBES_CHANNEL_ID;
const RLCLAW_CHANNEL_ID = process.env.DISCORD_RLCLAW_CHANNEL_ID;
const USER_ID = process.env.DISCORD_USER_ID;
const COMMANDS_FILE = path.join(__dirname, "..", "commands.txt");
const RESPONSE_FILE = path.join(__dirname, "discord_response.txt");
const OUTBOX_DIR = path.join(__dirname, "discord_outbox");

if (!TOKEN || !VIBES_CHANNEL_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_VIBES_CHANNEL_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const channels: Record<string, TextChannel> = {};

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot online as ${c.user.tag}`);

  const vibes = client.channels.cache.get(VIBES_CHANNEL_ID!) as TextChannel;
  if (vibes) channels.vibes = vibes;

  if (RLCLAW_CHANNEL_ID) {
    const rlclaw = client.channels.cache.get(RLCLAW_CHANNEL_ID) as TextChannel;
    if (rlclaw) channels.rlclaw = rlclaw;
  }

  // Start watching for outbound messages
  watchOutbox();
  watchResponses();
});

// Listen for @mentions from authorized user
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== VIBES_CHANNEL_ID) return;
  if (!message.mentions.has(client.user!.id)) return;

  if (message.author.id !== USER_ID) {
    await message.reply("not authorized");
    return;
  }

  const content = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!content) {
    await message.reply("send a command after the mention");
    return;
  }

  fs.writeFileSync(COMMANDS_FILE, content);
  console.log(`[${new Date().toISOString()}] Command: ${content.slice(0, 100)}`);
  await message.react("\u2705");
});

// Watch outbox dir for messages from the orchestrator/notify system
function watchOutbox() {
  setInterval(async () => {
    try {
      if (!fs.existsSync(OUTBOX_DIR)) return;
      const files = fs.readdirSync(OUTBOX_DIR).sort();
      for (const file of files) {
        const filePath = path.join(OUTBOX_DIR, file);
        const content = fs.readFileSync(filePath, "utf-8").trim();
        fs.unlinkSync(filePath);

        if (!content) continue;

        // Determine channel from filename (e.g. 1234567_vibes.txt)
        const channelName = file.includes("_rlclaw") ? "rlclaw" : "vibes";
        const channel = channels[channelName];
        if (!channel) continue;

        const chunks = content.match(/[\s\S]{1,1990}/g) || [content];
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch {}
  }, 2_000);
}

// Watch for orchestrator direct responses (from commands.txt processing)
function watchResponses() {
  setInterval(async () => {
    try {
      if (!fs.existsSync(RESPONSE_FILE)) return;
      const response = fs.readFileSync(RESPONSE_FILE, "utf-8").trim();
      if (!response) return;

      fs.unlinkSync(RESPONSE_FILE);

      if (channels.vibes) {
        const chunks = response.match(/[\s\S]{1,1990}/g) || [response];
        for (const chunk of chunks) {
          await channels.vibes.send(chunk);
        }
      }
    } catch {}
  }, 2_000);
}

client.login(TOKEN);
