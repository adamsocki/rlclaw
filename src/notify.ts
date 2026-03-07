import { recordDiscord } from "./telemetry";

type Channel = "vibes" | "rlclaw";

function getWebhook(channel: Channel): string | undefined {
  return channel === "vibes"
    ? process.env.DISCORD_WEBHOOK_VIBES
    : process.env.DISCORD_WEBHOOK_RLCLAW;
}

function getMention(): string {
  return process.env.DISCORD_USER_ID ? `<@${process.env.DISCORD_USER_ID}>` : "";
}

export async function notify(
  content: string,
  level: "info" | "success" | "error" | "input" = "info",
  channel: Channel = "vibes"
): Promise<void> {
  const webhook = getWebhook(channel);
  if (!webhook) {
    console.error(`[notify] DISCORD_WEBHOOK_${channel.toUpperCase()} not set in .env`);
    return;
  }

  const mention = getMention();
  const ping = (level === "input" || level === "error") && mention ? ` ${mention}` : "";
  const msg = `**rlclaw**${ping} — ${content}`;
  const truncated = msg.length > 1990 ? msg.slice(0, 1990) + "..." : msg;

  // Log to telemetry
  try { recordDiscord(channel, truncated); } catch {}

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: truncated }),
    });
  } catch {
    console.error("[notify] Discord webhook failed");
  }
}
