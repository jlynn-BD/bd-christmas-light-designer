import path from "path";
import { buildReport, loadSessionsBetween } from "./analytics.js";
import { buildTeamReport, loadTeamActivity } from "./team.js";
import { hasTeamSession } from "./team-auth.js";

/**
 * "Daily numbers" for the sales team (/team/daily): what happened on one calendar day, in Indianapolis
 * time — customer visits and requests, an hourly picture of when people show up, and what the team
 * produced in the Design Studio — with the previous day alongside for comparison.
 *
 * Aggregates only: no names, emails, phone numbers or addresses ever appear here.
 */

export const TZ = "America/Indiana/Indianapolis";
const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------- calendar-day helpers (daylight-saving safe) ---------- */

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function tzOffsetMs(ms) {
  const v = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second) - ms;
}

export const localDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const localHour = (ms) => Number(partsFmt.formatToParts(new Date(ms)).find((p) => p.type === "hour").value);

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The exact instant local midnight begins on a calendar date (handles 23- and 25-hour days). */
export function localMidnightMs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const t = guess - tzOffsetMs(guess);
  return guess - tzOffsetMs(t);
}

export const dayBounds = (dateStr) => ({ from: localMidnightMs(dateStr), to: localMidnightMs(addDays(dateStr, 1)) });

/* ---------- numbers ---------- */

function customerKpis(sessions, now) {
  const report = buildReport(sessions, { now });
  const designs = sessions.filter((s) => s.ev.generate_completed).length;
  const failures = sessions.reduce((n, s) => n + (s.ev.generate_failed?.n ?? 0), 0);
  const outOfArea = sessions.filter((s) => s.ev.zip_out_of_area).length;
  return {
    report,
    kpis: {
      visits: report.totals.visits,
      submitted: report.totals.converted,
      residentialLeads: report.totals.residentialLeads,
      commercialLeads: report.totals.commercialLeads,
      conversionPct: report.totals.conversionPct,
      designsGenerated: designs,
      generationFailures: failures,
      outOfAreaTries: outOfArea,
    },
  };
}

export function buildDaily({ date, now = Date.now(), sessions, prevSessions, teamRows, prevTeamRows }) {
  const { from } = dayBounds(date);
  const today = localDate(now);
  const { report, kpis } = customerKpis(sessions, now);
  const { kpis: prevKpis } = customerKpis(prevSessions, now);

  // Who asked for what — counts only, so staff know how many follow-ups the day produced.
  const leadsByPreference = { call: 0, quoteOnly: 0, other: 0 };
  for (const s of sessions) {
    if (!s.ev.lead_submitted) continue;
    const pref = s.ev.lead_submitted.p?.contactPreference;
    if (pref === "call") leadsByPreference.call += 1;
    else if (pref === "quote_only") leadsByPreference.quoteOnly += 1;
    else leadsByPreference.other += 1;
  }

  // When people show up and when requests come in (Indianapolis hours 0-23).
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0, requests: 0 }));
  for (const s of sessions) {
    hourly[localHour(s.ev.app_started.t)].visits += 1;
    const done = s.ev.lead_submitted ?? s.ev.commercial_submitted;
    if (done && localDate(done.t) === date) hourly[localHour(done.t)].requests += 1;
  }

  const team = buildTeamReport(teamRows, { now, days: 1 });
  const prevTeam = buildTeamReport(prevTeamRows, { now, days: 1 });
  const teamKpis = (t) => ({ concepts: t.totals.concepts, delivered: t.totals.delivered, emails: t.totals.emails, pdfs: t.totals.pdfs, crmAdds: t.totals.crmAdds });

  return {
    date,
    isToday: date === today,
    startsAt: from,
    generatedAt: new Date(now).toISOString(),
    currentHour: date === today ? localHour(now) : null,
    customers: {
      kpis,
      leadsByPreference,
      funnel: report.funnel.filter((r) => r.key !== "res"),
      insights: report.insights,
      hourly,
      devices: report.audience.devices,
    },
    team: { kpis: teamKpis(team), reps: team.reps },
    previous: { date: addDays(date, -1), customers: prevKpis, team: teamKpis(prevTeam) },
  };
}

/* ---------- routes ---------- */

const teamOnly = (req, res, next) => {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  if (!hasTeamSession(req)) return res.status(401).json({ error: "Your session expired. Please sign in again.", code: "signed_out" });
  next();
};

export function registerDailyRoutes(app) {
  // The page itself: signed-in team members get it, everyone else is sent to the team sign-in.
  app.get("/team/daily", (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    if (!hasTeamSession(req)) return res.redirect("/team");
    res.sendFile(path.join(process.cwd(), "team", "daily.html"));
  });

  app.get("/team/api/daily", teamOnly, async (req, res) => {
    try {
      const now = Date.now();
      const today = localDate(now);
      let date = String(req.query.date ?? today);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: "Pick a valid date." });
      if (date > today) date = today;
      if (date < localDate(now - 400 * DAY_MS)) return res.status(400).json({ error: "That date is too far back." });

      const cur = dayBounds(date);
      const prev = dayBounds(addDays(date, -1));
      const [sessions, prevSessions, teamRows, prevTeamRows] = await Promise.all([
        loadSessionsBetween(cur.from, cur.to),
        loadSessionsBetween(prev.from, prev.to),
        loadTeamActivity(cur.from, cur.to),
        loadTeamActivity(prev.from, prev.to),
      ]);
      res.json(buildDaily({ date, now, sessions, prevSessions, teamRows, prevTeamRows }));
    } catch (err) {
      console.error("[daily] failed:", err);
      res.status(500).json({ error: "Couldn't load the daily numbers. Please try again." });
    }
  });
}
