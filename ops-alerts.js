import { sendOpsAlert } from "./lead-email.js";

/**
 * Tells the owner when the AI service itself is broken (out of credits, key rejected, model retired) —
 * the kind of problem customers can't fix and would otherwise only show up as vague "try again" boxes.
 * At most one email per kind every 6 hours, however many visitors hit the problem.
 */

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const lastSent = new Map();

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PROBLEMS = {
  billing: {
    subject: "⚠️ Blue Duck app: AI credits are used up — design generation is DOWN",
    what: "Google says the prepaid credits on the Gemini API account are depleted (error 402). Nobody can generate designs right now — customers on the public app and the sales team in the Design Studio all get errors.",
    fix: [
      'Go to <a href="https://ai.studio/projects">https://ai.studio/projects</a> and sign in with the Google account that owns the API key.',
      "Open the project the key belongs to and add credits under billing (or switch on billing).",
      "Generation starts working again within a minute — no redeploy needed.",
      "Tip: set a spending limit or low-balance alert there so you hear about it before customers do.",
    ],
  },
  auth: {
    subject: "⚠️ Blue Duck app: the AI key was rejected — design generation is DOWN",
    what: "Google rejected the Gemini API key (it may have been revoked, restricted, or replaced). Nobody can generate designs right now.",
    fix: [
      "In Render, open the bd-christmas-light-designer service → Environment and check the GEMINI_API_KEY value.",
      'In <a href="https://ai.studio/apikey">AI Studio</a>, confirm the key still exists and is allowed to use the image model.',
      'Update it on Render and click "Save, rebuild, and deploy".',
    ],
  },
  model: {
    subject: "⚠️ Blue Duck app: the AI model is no longer available — design generation is DOWN",
    what: "Google has retired or renamed the image model the app uses. Nobody can generate designs right now.",
    fix: ["This needs a small code change to point the app at Google's current image model — contact your developer (or ask Claude to update it)."],
  },
};

export async function reportAiProblem(kind, detail) {
  const p = PROBLEMS[kind];
  if (!p) return;
  const now = Date.now();
  if (now - (lastSent.get(kind) ?? 0) < COOLDOWN_MS) return;
  lastSent.set(kind, now);

  console.error(`[ops-alert] AI problem: ${kind} — ${String(detail).slice(0, 200)}`);
  const when = new Date(now).toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis", dateStyle: "medium", timeStyle: "short" });
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #b3212c; margin-bottom: 4px;">${escapeHtml(p.subject.replace("⚠️ ", ""))}</h2>
      <p style="color:#5a6b85; margin-top:0;">First detected ${escapeHtml(when)} (Indianapolis time)</p>
      <p style="font-size: 15px; line-height: 1.5;">${escapeHtml(p.what)}</p>
      <h3 style="color:#16305c; margin-bottom: 6px;">How to fix it</h3>
      <ol style="font-size: 15px; line-height: 1.6; padding-left: 20px;">${p.fix.map((f) => `<li>${f}</li>`).join("")}</ol>
      <p style="color:#5a6b85; font-size: 13px;">Google's message: <em>${escapeHtml(String(detail).slice(0, 300))}</em></p>
      <p style="color:#8a97ad; font-size: 12px;">You'll get at most one of these emails every 6 hours while the problem continues.</p>
    </div>`;
  const sent = await sendOpsAlert({ subject: p.subject, html });
  if (!sent.ok) console.error("[ops-alert] could not email the alert:", sent.error);
}

// Wording shown to people when the AI service is down.
export const CUSTOMER_DOWN_MESSAGE =
  "Our design tool is temporarily unavailable. Please try again in a little while — or email hello@trustblueduck.com and we'll create your design for you.";

export const STAFF_DOWN_MESSAGE = {
  billing: "The AI service has run out of credits. Add credits at ai.studio/projects (billing), then try again. The owner has been emailed.",
  auth: "The AI service rejected our key. Check GEMINI_API_KEY on Render, then try again. The owner has been emailed.",
  model: "Google has retired the AI model we use. A code update is needed. The owner has been emailed.",
};
