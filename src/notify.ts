const DISCORD_WEBHOOK =
  "REDACTED_WEBHOOK_URL";

const USER_ID = "676111162605043769";
const MENTION = `<@${USER_ID}>`;

export async function notify(
  content: string,
  level: "info" | "success" | "error" | "input" = "info"
): Promise<void> {
  const prefix =
    level === "success"
      ? ":white_check_mark:"
      : level === "error"
        ? ":x:"
        : level === "input"
          ? ":question:"
          : ":brain:";

  const ping = level === "input" || level === "error" ? ` ${MENTION}` : "";
  const msg = `${prefix} **rlclaw**${ping} — ${content}`;

  const truncated = msg.length > 1990 ? msg.slice(0, 1990) + "..." : msg;

  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: truncated }),
    });
  } catch {
    console.error("[notify] Discord webhook failed");
  }
}
