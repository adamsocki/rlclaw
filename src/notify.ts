const DISCORD_WEBHOOK =
  "REDACTED_WEBHOOK_URL";

export async function notify(
  content: string,
  level: "info" | "success" | "error" = "info"
): Promise<void> {
  const prefix =
    level === "success" ? ":white_check_mark:" : level === "error" ? ":x:" : ":brain:";
  const msg = `${prefix} **rlclaw** — ${content}`;

  // Discord max message length is 2000
  const truncated = msg.length > 1990 ? msg.slice(0, 1990) + "..." : msg;

  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: truncated }),
    });
  } catch {
    // Don't crash the orchestrator if Discord is down
    console.error("[notify] Discord webhook failed");
  }
}
