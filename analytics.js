import crypto from "crypto";
import { getClientIp, isAllowlisted } from "./abuse-guard.js";

/**
 * Customer-journey / funnel analytics.
 *
 * The browser sends small anonymous events (no names, emails, phone numbers, addresses or photos —
 * just a random per-visit id, what happened, and a few non-identifying details like which style or
 * package was picked). They land in Postgres and the /admin dashboard turns them into a funnel that
 * shows where visitors leave.
 *
 * Privacy: IP addresses are NOT stored with analytics events.
 */

/* ---------- event ingestion ---------- */

// Only these events are accepted, so junk can't pollute the tables.
const ALLOWED_EVENTS = new Set([
  "app_started",
  "zip_in_area",
  "zip_out_of_area",
  "zip_check_failed",
  "property_chosen",
  "commercial_form_viewed",
  "commercial_submitted",
  "photo_selected",
  "generate_started",
  "generate_completed",
  "generate_failed",
  "design_chosen",
  "design_loved",
  "customize_started",
  "customize_done",
  "package_viewed",
  "package_selected",
  "lead_form_viewed",
  "lead_submitted",
  "submit_failed",
  "step_reached",
  "went_back",
  "page_hidden",
]);

const DEVICES = new Set(["phone", "tablet", "desktop"]);
const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_EVENTS_PER_REQUEST = 30;

let dbPool = null;
// Fallback for local dev without a database (bounded so it can never grow without limit).
const memoryEvents = [];
const MEMORY_CAP = 20000;

export async function initAnalytics(pool) {
  dbPool = pool;
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL,
        props JSONB,
        device TEXT,
        embedded BOOLEAN,
        referrer TEXT,
        internal BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events (session_id)`);
  } catch (err) {
    console.error("Failed to ensure analytics table exists:", err);
  }
}

function cleanProps(p) {
  const out = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p).slice(0, 8)) {
    if (!/^[a-zA-Z_]{1,24}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 60);
  }
  return out;
}

function isLocalHost(req) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname);
}

/** POST /api/events — always answers 204 quickly; analytics must never get in a visitor's way. */
export async function ingestEvents(req, res) {
  res.status(204).end();

  const body = req.body ?? {};
  if (!SID_RE.test(String(body.sid ?? ""))) return;
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  if (!events.length) return;

  const device = DEVICES.has(body.device) ? body.device : null;
  const embedded = Boolean(body.embedded);
  const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 80) : null;
  const internal = isAllowlisted(getClientIp(req)) || isLocalHost(req) || body.internal === true;
  const now = Date.now();

  const rows = [];
  for (const ev of events) {
    if (!ev || !ALLOWED_EVENTS.has(ev.e)) continue;
    // Events are batched on the client, so each carries "how long ago it happened".
    const ago = Math.min(Math.max(Number(ev.ago) || 0, 0), 10 * 60 * 1000);
    rows.push({
      session_id: body.sid,
      event: ev.e,
      props: cleanProps(ev.p),
      device,
      embedded,
      referrer,
      internal,
      created_at: new Date(now - ago),
    });
  }
  if (!rows.length) return;

  if (!dbPool) {
    memoryEvents.push(...rows);
    if (memoryEvents.length > MEMORY_CAP) memoryEvents.splice(0, memoryEvents.length - MEMORY_CAP);
    return;
  }

  try {
    const values = [];
    const placeholders = rows.map((r, i) => {
      const o = i * 8;
      values.push(r.session_id, r.event, JSON.stringify(r.props), r.device, r.embedded, r.referrer, r.internal, r.created_at);
      return `($${o + 1},$${o + 2},$${o + 3}::jsonb,$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
    });
    await dbPool.query(
      `INSERT INTO analytics_events (session_id, event, props, device, embedded, referrer, internal, created_at)
       VALUES ${placeholders.join(",")}`,
      values
    );
  } catch (err) {
    console.error("Failed to store analytics events:", err);
  }
}

/* ---------- funnel definition (mirrors the app's real steps) ---------- */

// Visitors get the "everyone" stages first; after choosing a property type they split into the
// residential path (the AI designer) or the commercial path (consultation request).
const COMMON_STAGES = [
  { key: "started", label: "Opened the app", events: ["app_started"] },
  { key: "zip_ok", label: "ZIP code is in our service area", events: ["zip_in_area"] },
  { key: "type", label: "Chose Residential or Commercial", events: ["property_chosen"] },
];

const RESIDENTIAL_STAGES = [
  { key: "photo", label: "Uploaded a photo of their home", wizard: "Step 1 · Design", events: ["photo_selected"] },
  { key: "gen_started", label: "Clicked “Show Me Every Style”", wizard: "Step 1 · Design", events: ["generate_started"] },
  { key: "gen_done", label: "AI designs were created", wizard: "Step 1 · Design", events: ["generate_completed"] },
  { key: "chosen", label: "Chose a design", wizard: "Step 2 · Confirm", events: ["design_chosen"] },
  { key: "pkg_viewed", label: "Viewed the packages", wizard: "Step 4 · Package", events: ["package_viewed"] },
  { key: "pkg_selected", label: "Selected a package", wizard: "Step 4 · Package", events: ["package_selected"] },
  { key: "lead_form", label: "Reached the contact form", wizard: "Step 5 · Quote", events: ["lead_form_viewed"] },
  { key: "submitted", label: "Submitted their request", wizard: "Step 5 · Quote", events: ["lead_submitted"] },
];

const COMMERCIAL_STAGES = [
  { key: "c_form", label: "Opened the consultation form", events: ["commercial_form_viewed"] },
  { key: "c_submitted", label: "Requested a consultation", events: ["commercial_submitted"] },
];

const ERROR_EVENTS = ["generate_failed", "submit_failed", "zip_out_of_area", "zip_check_failed"];
const ABANDON_AFTER_MS = 30 * 60 * 1000;

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const tally = (map, key) => key && map.set(key, (map.get(key) ?? 0) + 1);
const topList = (map, n = 10) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

/** Collapses raw event rows into one object per visit: first-seen time + last props for each event. */
export function groupSessions(rows) {
  const sessions = new Map();
  for (const r of rows) {
    let s = sessions.get(r.session_id);
    if (!s) {
      s = { id: r.session_id, first: r.t, last: r.t, device: r.device, embedded: r.embedded, referrer: r.referrer, internal: r.internal, ev: {} };
      sessions.set(r.session_id, s);
    }
    s.first = Math.min(s.first, r.t);
    s.last = Math.max(s.last, r.t);
    if (r.internal) s.internal = true;
    if (!s.device && r.device) s.device = r.device;
    if (!s.referrer && r.referrer) s.referrer = r.referrer;
    const cur = s.ev[r.event];
    if (!cur) s.ev[r.event] = { t: r.t, n: 1, p: r.props ?? {}, all: [r.props ?? {}] };
    else {
      cur.t = Math.min(cur.t, r.t);
      cur.n += 1;
      cur.p = r.props ?? {};
      cur.all.push(r.props ?? {});
    }
  }
  return [...sessions.values()];
}

const has = (s, stage) => stage.events.some((e) => s.ev[e]);

function pathOf(s) {
  const type = s.ev.property_chosen?.p?.type;
  if (type === "commercial" || s.ev.commercial_form_viewed || s.ev.commercial_submitted) return "commercial";
  if (type === "residential" || RESIDENTIAL_STAGES.some((st) => has(s, st))) return "residential";
  return null;
}

/** Index of the furthest funnel stage reached (any later stage implies the earlier ones happened). */
function furthest(s, stages) {
  let idx = -1;
  stages.forEach((st, i) => {
    if (has(s, st)) idx = i;
  });
  return idx;
}

function stageTime(s, stage) {
  const ts = stage.events.map((e) => s.ev[e]?.t).filter(Boolean);
  return ts.length ? Math.min(...ts) : null;
}

export function buildReport(sessions, { now = Date.now(), tz = "America/Indiana/Indianapolis", days = 30 } = {}) {
  const total = sessions.length;
  const residential = sessions.filter((s) => pathOf(s) === "residential");
  const commercial = sessions.filter((s) => pathOf(s) === "commercial");

  const reachedCommon = COMMON_STAGES.map((st, i) => {
    // Reaching a later common stage (or any path stage) implies the earlier common ones happened.
    return sessions.filter((s) => {
      for (let j = i; j < COMMON_STAGES.length; j++) if (has(s, COMMON_STAGES[j])) return true;
      return pathOf(s) !== null;
    }).length;
  });

  const converted = (s) => has(s, RESIDENTIAL_STAGES[RESIDENTIAL_STAGES.length - 1]) || has(s, COMMERCIAL_STAGES[1]);
  const convertedCount = sessions.filter(converted).length;

  // ----- funnel rows
  const rows = [];
  const addRow = (key, label, wizard, count, prev) => {
    rows.push({
      key,
      label,
      wizard: wizard ?? null,
      count,
      pctOfStart: pct(count, reachedCommon[0]),
      prevCount: prev,
      convPct: prev == null ? null : pct(count, prev),
      dropCount: prev == null ? null : Math.max(prev - count, 0),
      dropPct: prev == null ? null : pct(Math.max(prev - count, 0), prev),
    });
  };
  addRow("started", COMMON_STAGES[0].label, null, reachedCommon[0], null);
  addRow("zip_ok", COMMON_STAGES[1].label, null, reachedCommon[1], reachedCommon[0]);
  addRow("type", COMMON_STAGES[2].label, null, reachedCommon[2], reachedCommon[1]);
  // Commercial visitors branch off here (they're tracked separately below), so they aren't "drop-offs".
  addRow("res", "↳ Chose Residential (AI designer)", null, residential.length, Math.max(reachedCommon[2] - commercial.length, residential.length));

  let prev = residential.length;
  const resReached = {};
  RESIDENTIAL_STAGES.forEach((st, i) => {
    const count = residential.filter((s) => furthest(s, RESIDENTIAL_STAGES) >= i).length;
    resReached[st.key] = count;
    addRow(st.key, st.label, st.wizard, count, prev);
    prev = count;
  });

  // ----- commercial branch
  const comReached = COMMERCIAL_STAGES.map((st, i) => commercial.filter((s) => furthest(s, COMMERCIAL_STAGES) >= i).length);
  const commercialBranch = {
    chose: commercial.length,
    openedForm: comReached[0],
    submitted: comReached[1],
    convPct: pct(comReached[1], commercial.length),
  };

  // ----- abandonment: visits that didn't convert and have been idle long enough to call it
  const abandonedSessions = [];
  let inProgress = 0;
  for (const s of sessions) {
    if (converted(s)) continue;
    if (now - s.last < ABANDON_AFTER_MS) inProgress += 1;
    else abandonedSessions.push(s);
  }

  const lastStageOf = (s) => {
    const p = pathOf(s);
    if (p === "residential") {
      const i = furthest(s, RESIDENTIAL_STAGES);
      if (i < 0) return { key: "res", stage: null };
      const stage = RESIDENTIAL_STAGES[i];
      // Chose a design, opted to customize, never reached the packages: they left on Step 3 (Lighting).
      if (stage.key === "chosen" && s.ev.customize_started) return { key: "customizing", stage: { ...stage, events: ["customize_started"], wizard: "Step 3 · Lighting" } };
      return { key: stage.key, stage };
    }
    if (p === "commercial") {
      const i = furthest(s, COMMERCIAL_STAGES);
      return i >= 0 ? { key: COMMERCIAL_STAGES[i].key, stage: COMMERCIAL_STAGES[i] } : { key: "c_chose", stage: null };
    }
    if (has(s, COMMON_STAGES[1])) return { key: "zip_ok", stage: COMMON_STAGES[1] };
    return { key: "started", stage: COMMON_STAGES[0] };
  };

  const ABANDON_LABELS = {
    started: "Left on the ZIP code screen (never got in)",
    zip_ok: "Left at ‘Residential or Commercial?’",
    res: "Left right after choosing Residential (no photo)",
    c_chose: "Left right after choosing Commercial",
    c_form: "Left the commercial form without submitting",
    customizing: "Left while customizing their design (Lighting step)",
    ...Object.fromEntries(RESIDENTIAL_STAGES.map((st) => [st.key, `Left after: ${st.label}`])),
  };
  // Stage-by-stage order so the table reads like the journey.
  const ABANDON_ORDER = ["started", "zip_ok", "res", "photo", "gen_started", "gen_done", "chosen", "customizing", "pkg_viewed", "pkg_selected", "lead_form", "c_chose", "c_form"];

  const byLastStage = new Map();
  for (const s of abandonedSessions) {
    const { key, stage } = lastStageOf(s);
    if (!byLastStage.has(key)) byLastStage.set(key, []);
    byLastStage.get(key).push({ s, stage });
  }

  const overallPhoneShare = pct(sessions.filter((s) => s.device === "phone").length, total);

  const wizardOfKey = (key, stage) => {
    if (key === "started" || key === "zip_ok") return "Before the wizard (ZIP / property type)";
    if (key === "c_chose" || key === "c_form") return "Commercial consultation form";
    if (key === "res") return "Step 1 · Design";
    return stage?.wizard ?? null;
  };

  const abandonment = ABANDON_ORDER.filter((k) => byLastStage.has(k)).map((key) => {
    const list = byLastStage.get(key);
    const errorReasons = new Map();
    let sawError = 0;
    const secs = [];
    let phones = 0;
    let wentBack = 0;
    for (const { s, stage } of list) {
      if (s.device === "phone") phones += 1;
      const errs = ERROR_EVENTS.filter((e) => s.ev[e]);
      if (errs.length) {
        sawError += 1;
        for (const e of errs) for (const p of s.ev[e].all) tally(errorReasons, p.reason ? `${e.replace(/_/g, " ")}: ${p.reason}` : e.replace(/_/g, " "));
      }
      if (s.ev.went_back) wentBack += 1;
      const t0 = stage ? stageTime(s, stage) : s.first;
      if (t0) secs.push(Math.max(0, (s.last - t0) / 1000));
    }
    return {
      key,
      label: ABANDON_LABELS[key] ?? key,
      wizard: wizardOfKey(key, list[0].stage),
      count: list.length,
      shareOfAbandoned: pct(list.length, abandonedSessions.length),
      phonePct: pct(phones, list.length),
      sawErrorPct: pct(sawError, list.length),
      wentBackPct: pct(wentBack, list.length),
      medianSecondsActive: median(secs),
      errors: topList(errorReasons, 4),
    };
  });

  // Same data, grouped by the five numbered wizard steps customers actually see.
  const WIZARD_ORDER = ["Before the wizard (ZIP / property type)", "Step 1 · Design", "Step 2 · Confirm", "Step 3 · Lighting", "Step 4 · Package", "Step 5 · Quote", "Commercial consultation form"];
  const byWizardStep = WIZARD_ORDER.map((step) => {
    const count = abandonment.filter((a) => a.wizard === step).reduce((n, a) => n + a.count, 0);
    return { step, count, shareOfAbandoned: pct(count, abandonedSessions.length) };
  }).filter((w) => w.count > 0);

  // ----- generation health
  const genStarted = sessions.reduce((n, s) => n + (s.ev.generate_started?.n ?? 0), 0);
  const genCompleted = sessions.reduce((n, s) => n + (s.ev.generate_completed?.n ?? 0), 0);
  const genFailReasons = new Map();
  const genMs = [];
  for (const s of sessions) {
    s.ev.generate_failed?.all.forEach((p) => tally(genFailReasons, p.reason ?? "error"));
    s.ev.generate_completed?.all.forEach((p) => typeof p.ms === "number" && genMs.push(p.ms));
  }
  const genFailed = [...genFailReasons.values()].reduce((a, b) => a + b, 0);

  // ----- choices
  const styles = new Map();
  const packages = new Map();
  const contactPrefs = new Map();
  const outOfArea = new Map();
  const referrers = new Map();
  const devices = new Map();
  let embedded = 0;
  for (const s of sessions) {
    tally(devices, s.device ?? "unknown");
    if (s.embedded) embedded += 1;
    tally(referrers, s.referrer || "(direct / none)");
    tally(styles, s.ev.design_chosen?.p?.style);
    tally(packages, s.ev.package_selected?.p?.package);
    tally(contactPrefs, s.ev.lead_submitted?.p?.contactPreference);
    s.ev.zip_out_of_area?.all.forEach((p) => tally(outOfArea, p.zip));
  }
  const chosenCount = resReached.chosen ?? 0;
  const customizeStarted = residential.filter((s) => s.ev.customize_started).length;
  const customizeDone = residential.filter((s) => s.ev.customize_done).length;

  const submitDurations = sessions.filter(converted).map((s) => {
    const st = s.ev.lead_submitted?.t ?? s.ev.commercial_submitted?.t;
    return st ? (st - s.first) / 1000 : null;
  }).filter((x) => x != null);

  // ----- daily trend (Indianapolis calendar days)
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const daily = new Map();
  for (const s of sessions) {
    const d = dayFmt.format(new Date(s.first));
    if (!daily.has(d)) daily.set(d, { date: d, started: 0, converted: 0 });
    const row = daily.get(d);
    row.started += 1;
    if (converted(s)) row.converted += 1;
  }

  // ----- plain-language takeaways
  const insights = [];
  const worst = [...abandonment].filter((a) => a.count >= 3).sort((a, b) => b.count - a.count)[0];
  if (worst) {
    const where = worst.label.startsWith("Left after: ")
      ? worst.label.replace(/^Left after: (.*)$/, "people who got as far as “$1” and went no further")
      : worst.label.replace(/^Left /, "people who left ");
    insights.push(`Biggest drop-off: ${where} — ${worst.shareOfAbandoned}% of everyone who left (${worst.count} visits).`);
    if (worst.phonePct - overallPhoneShare >= 15)
      insights.push(`Phone users are over-represented among people who leave at that point (${worst.phonePct}% vs ${overallPhoneShare}% of all visitors) — worth testing that screen on a phone.`);
    if (worst.sawErrorPct >= 25)
      insights.push(`${worst.sawErrorPct}% of those leavers hit an error first — see “Errors they saw” below.`);
  }
  if (genStarted >= 5 && pct(genFailed, genStarted) >= 10)
    insights.push(`${pct(genFailed, genStarted)}% of design generations failed or were blocked (${genFailed} of ${genStarted}) — that's lost customers right at the best part of the app.`);
  const gsm = median(genMs);
  if (gsm && gsm > 45000) insights.push(`Designs take a median of ${Math.round(gsm / 1000)}s to appear — long waits cost conversions.`);
  if (outOfArea.size) {
    const n = [...outOfArea.values()].reduce((a, b) => a + b, 0);
    insights.push(`${n} visit${n === 1 ? "" : "s"} tried ZIP codes outside the service area — see the list below for expansion demand.`);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    days,
    totals: {
      visits: total,
      converted: convertedCount,
      conversionPct: pct(convertedCount, total),
      residentialLeads: resReached.submitted ?? 0,
      commercialLeads: comReached[1],
      inProgress,
      abandoned: abandonedSessions.length,
      medianSecondsToSubmit: median(submitDurations),
    },
    funnel: rows,
    commercial: commercialBranch,
    abandonment,
    byWizardStep,
    generation: {
      started: genStarted,
      completed: genCompleted,
      failed: genFailed,
      failureReasons: topList(genFailReasons),
      medianSeconds: gsm ? Math.round(gsm / 1000) : null,
    },
    choices: {
      styles: topList(styles),
      packages: topList(packages),
      contactPreferences: topList(contactPrefs),
      customizedPct: pct(customizeStarted, chosenCount),
      customizeFinishedPct: pct(customizeDone, customizeStarted),
    },
    audience: { devices: topList(devices), embeddedPct: pct(embedded, total), referrers: topList(referrers, 6) },
    outOfAreaZips: topList(outOfArea, 15),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    insights,
  };
}

/* ---------- data access ---------- */

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, all: 3650 };

export async function loadSessions({ range = "30d", device = "all", includeInternal = false }) {
  const days = RANGES[range] ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let rows;
  if (dbPool) {
    const { rows: dbRows } = await dbPool.query(
      `SELECT session_id, event, props, device, embedded, referrer, internal,
              (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS t
         FROM analytics_events
        WHERE created_at >= $1
        ORDER BY created_at
        LIMIT 600000`,
      [since]
    );
    rows = dbRows.map((r) => ({ ...r, t: Number(r.t) }));
  } else {
    rows = memoryEvents.filter((r) => r.created_at >= since).map((r) => ({ ...r, t: r.created_at.getTime() }));
  }

  let sessions = groupSessions(rows);
  if (!includeInternal) sessions = sessions.filter((s) => !s.internal);
  if (DEVICES.has(device)) sessions = sessions.filter((s) => s.device === device);
  // A visit only counts if it actually opened the app (drops stray events from visits cut by the range edge).
  sessions = sessions.filter((s) => s.ev.app_started || s.first >= since.getTime());
  return { sessions, days };
}

export async function reportHandler(req, res) {
  try {
    const { range = "30d", device = "all", internal = "0" } = req.query;
    const { sessions, days } = await loadSessions({ range: String(range), device: String(device), includeInternal: internal === "1" });
    res.set("Cache-Control", "no-store");
    res.json(buildReport(sessions, { days }));
  } catch (err) {
    console.error("Failed to build analytics report:", err);
    res.status(500).json({ error: "Could not build the report." });
  }
}

/* ---------- admin authentication ---------- */

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();
const failedLogins = new Map(); // ip -> { count, start }

/**
 * Password gate for /admin (HTTP Basic — the browser shows its own login box). Any username works;
 * the password is the ADMIN_PASSWORD environment variable. With no password configured the
 * dashboard is simply off.
 */
export function adminAuth(req, res, next) {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return res.status(503).type("text").send("The analytics dashboard is turned off. Set ADMIN_PASSWORD on the server to enable it.");
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const f = failedLogins.get(ip);
  if (f && now - f.start < 15 * 60 * 1000 && f.count >= 10) {
    return res.status(429).type("text").send("Too many failed attempts. Try again in 15 minutes.");
  }

  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (crypto.timingSafeEqual(sha(supplied), sha(password))) {
      failedLogins.delete(ip);
      return next();
    }
    const cur = f && now - f.start < 15 * 60 * 1000 ? f : { count: 0, start: now };
    cur.count += 1;
    failedLogins.set(ip, cur);
  }

  res.set("WWW-Authenticate", 'Basic realm="Blue Duck Analytics", charset="UTF-8"');
  return res.status(401).type("text").send("Password required.");
}
