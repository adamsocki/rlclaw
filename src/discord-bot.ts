import { Client, GatewayIntentBits, Events } from "discord.js";
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
const USER_ID = process.env.DISCORD_USER_ID;
const COMMANDS_FILE = path.join(__dirname, "..", "commands.txt");
const RESPONSE_FILE = path.join(__dirname, "discord_response.txt");

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

let vibesChannel: any = null;

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot online as ${c.user.tag}`);
  console.log(`Mention @${c.user.username} in #vibes to send commands`);
  vibesChannel = client.channels.cache.get(VIBES_CHANNEL_ID!);

  // Watch for orchestrator responses
  watchResponses();
});

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

  // Write command and acknowledge immediately
  fs.writeFileSync(COMMANDS_FILE, content);
  console.log(`[${new Date().toISOString()}] Command: ${content.slice(0, 100)}`);
  await message.react("\u2705");
});

// Poll for orchestrator responses and post them
function watchResponses() {
  setInterval(async () => {
    try {
      if (!fs.existsSync(RESPONSE_FILE)) return;
      const response = fs.readFileSync(RESPONSE_FILE, "utf-8").trim();
      if (!response) return;

      fs.unlinkSync(RESPONSE_FILE);

      if (vibesChannel) {
        const chunks = response.match(/[\s\S]{1,1990}/g) || [response];
        for (const chunk of chunks) {
          await vibesChannel.send(chunk);
        }
      }
    } catch {}
  }, 2_000);
}

client.login(TOKEN);
