/**
 * Builders for the MCP Prompts primitive (v0.4) — reusable, user-triggered
 * workflows surfaced by clients as slash commands. Each gathers live note data
 * via store/config and returns prompt messages for the host's model to act on.
 */
import { getDailyDir, todayStamp } from "./config.js";
import { listNotes, listTodos, readNote } from "./store.js";

export interface PromptResult {
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
  [key: string]: unknown; // satisfy the SDK's GetPromptResult index signature
}

const userMessage = (text: string): PromptResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Short, whitespace-collapsed excerpt of a note's content. */
async function excerpt(name: string, max = 240): Promise<string> {
  try {
    const { text } = await readNote(name);
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
  } catch {
    return "";
  }
}

/** /weekly_review — summarize the last 7 days of notes + open todos. */
export async function weeklyReview(): Promise<PromptResult> {
  const cutoff = Date.now() - WEEK_MS;
  const recent = listNotes(0, 500).items.filter((n) => n.mtimeMs >= cutoff).slice(0, 30);
  const todos = await listTodos(false);

  const noteBlock = recent.length
    ? (await Promise.all(recent.map(async (n) => `### ${n.name} — ${n.title}\n${await excerpt(n.name)}`))).join("\n\n")
    : "(no notes modified in the last 7 days)";
  const todoBlock = todos.length
    ? todos.map((t) => `- ${t.text} (${t.note})`).join("\n")
    : "(no open todos)";

  return userMessage(
    `Here are my notes from the past 7 days and my open todos. Please write a concise weekly review: ` +
      `what I worked on, recurring themes, progress, and anything I should follow up on next week.\n\n` +
      `## Recent notes\n\n${noteBlock}\n\n## Open todos\n\n${todoBlock}`,
  );
}

/** /summarize_note — summarize one note by name. */
export async function summarizeNote(name: string): Promise<PromptResult> {
  const { text } = await readNote(name);
  return userMessage(
    `Summarize the following note ("${name}") in a few bullet points, capturing key ideas and any action items.\n\n---\n${text}`,
  );
}

/** /daily_standup — draft a standup from yesterday + today's daily notes and todos. */
export async function dailyStandup(): Promise<PromptResult> {
  const today = todayStamp();
  const yesterday = todayStamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const dir = getDailyDir();
  const todayNote = await excerpt(`${dir}/${today}`, 600);
  const yestNote = await excerpt(`${dir}/${yesterday}`, 600);
  const todos = await listTodos(false);
  const todoBlock = todos.length ? todos.map((t) => `- ${t.text}`).join("\n") : "(none)";

  return userMessage(
    `Draft a short standup update (Yesterday / Today / Blockers) from my notes.\n\n` +
      `## Yesterday (${yesterday})\n${yestNote || "(no note)"}\n\n` +
      `## Today (${today})\n${todayNote || "(no note)"}\n\n## Open todos\n${todoBlock}`,
  );
}
