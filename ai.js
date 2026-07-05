// /api/ai.js
// Single serverless endpoint that powers every "AI" feature in VISION HUNTER.
// The Anthropic API key lives only here, server-side, as an env var (ANTHROPIC_API_KEY).
// The frontend calls this endpoint with { action, ...payload } and gets structured JSON back.

const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

async function callClaude({ system, messages, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in this Vercel project's environment variables.");
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

// Strip ```json fences etc. and parse. Throws if it can't find valid JSON.
function parseJsonLoose(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  let from = start;
  if (startArr !== -1 && (start === -1 || startArr < start)) from = startArr;
  const jsonSlice = from >= 0 ? cleaned.slice(from) : cleaned;
  return JSON.parse(jsonSlice);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const { action } = body;

  try {
    switch (action) {
      case "chat": {
        const { message, history = [] } = body;
        const system =
          "You are VISION HUNTER, a warm, non-judgmental ADHD-aware life companion. " +
          "Keep replies short (2-5 sentences), concrete, and action-oriented. " +
          "Prefer tiny next steps over long advice. Never be clinical or condescending. " +
          "You can help with: breaking tasks down, planning the day, organizing ideas, " +
          "logging wins, and processing overwhelm.";

        const messages = [
          ...history.slice(-10).map((h) => ({
            role: h.role === "ai" ? "assistant" : "user",
            content: h.text,
          })),
          { role: "user", content: message },
        ];

        const reply = await callClaude({ system, messages, maxTokens: 400 });
        res.status(200).json({ reply: reply.trim() });
        return;
      }

      case "breakdown": {
        const { title } = body;
        const system =
          "You break down tasks for someone with ADHD, Goblin.tools 'Magic ToDo' style. " +
          "Produce 4-6 tiny, concrete, sequential, dopamine-friendly steps. " +
          "Respond ONLY with a JSON array of strings, nothing else. No markdown, no preamble.";

        const raw = await callClaude({
          system,
          messages: [{ role: "user", content: `Task: "${title}"` }],
          maxTokens: 400,
        });

        const steps = parseJsonLoose(raw);
        res.status(200).json({ steps });
        return;
      }

      case "organize_ideas": {
        const { ideas = [] } = body;
        const system =
          "You organize a list of raw ideas using the PARA method (Projects, Areas, Resources, Archive). " +
          "For each PROJECT, include one concrete 'next action'. Respond ONLY with JSON in exactly this shape, no markdown: " +
          `{"projects":[{"content":"...","next":"..."}],"areas":[{"content":"..."}],"resources":[{"content":"..."}]}`;

        const ideaList = ideas.map((i, idx) => `${idx + 1}. ${i.content}`).join("\n");

        const raw = await callClaude({
          system,
          messages: [{ role: "user", content: `Ideas:\n${ideaList}` }],
          maxTokens: 800,
        });

        const organized = parseJsonLoose(raw);
        res.status(200).json(organized);
        return;
      }

      case "macros": {
        const { description } = body;
        const system =
          "You are a nutrition estimator. Given a free-text meal description, estimate protein (p), " +
          "carbs (c), and fat (f) in grams as realistic whole numbers for a single adult meal. " +
          'Respond ONLY with JSON: {"p":number,"c":number,"f":number}. No markdown, no explanation.';

        const raw = await callClaude({
          system,
          messages: [{ role: "user", content: description }],
          maxTokens: 100,
        });

        const numbers = parseJsonLoose(raw);
        const p = Math.round(numbers.p);
        const c = Math.round(numbers.c);
        const f = Math.round(numbers.f);
        res.status(200).json({
          display: `~${p}P • ${c}C • ${f}F`,
          numbers: { p, c, f },
        });
        return;
      }

      case "capture": {
        const { text } = body;
        const system =
          "You triage a raw brain-dump from someone with ADHD into exactly one category: " +
          "Task, Idea, or Journal. " +
          "- Task: something actionable they need to do. Include a short 'title' (<=70 chars). " +
          "- Idea: a business idea, thought, or spark. Include 'para' as one of Project/Area/Resource/Archive. " +
          "- Journal: a reflection, feeling, or note about their day. " +
          'Respond ONLY with JSON: {"category":"Task"|"Idea"|"Journal","title":"...","para":"..."} ' +
          "(omit fields that don't apply). No markdown, no explanation.";

        const raw = await callClaude({
          system,
          messages: [{ role: "user", content: text }],
          maxTokens: 200,
        });

        const result = parseJsonLoose(raw);
        res.status(200).json(result);
        return;
      }

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }
  } catch (err) {
    console.error("[/api/ai] error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
};
