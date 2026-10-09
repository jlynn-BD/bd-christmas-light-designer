import path from "path";
import { getClientIp } from "./abuse-guard.js";
import { teamEnabled, passwordMatches, hasTeamSession, startTeamSession, endTeamSession } from "./team-auth.js";
import { generatePresentationPdf } from "./team-pdf.js";
import { sendConceptEmail } from "./lead-email.js";
import { syncConceptToCrm } from "./lead-crm.js";

/**
 * Internal sales tool (/team): upload a customer's house photo -> generate designs -> pick one ->
 * download a customer-ready presentation PDF.
 *
 * It is deliberately walled off from the customer journey:
 *   - its own login, its own pages, its own API (/team/api/*)
 *   - it never writes to analytics_events, so staff can't distort customer-funnel numbers
 *     (and funnel events from a signed-in staff browser are dropped, see analytics.js)
 *   - it has its own spending limits, separate from the public per-visitor quotas
 *   - its activity (who generated what, how often) goes to team_activity, with no customer details
 *
 * Beyond building the PDF, a rep can email it to the customer straight from the tool and (optionally)
 * save the customer to the GoHighLevel CRM. /admin shows a team activity report built from team_activity.
 */

const DAILY_LIMIT = Number(process.env.TEAM_DAILY_LIMIT) || 150; // generations per rolling 24h, whole team
const MAX_CONCURRENT = Number(process.env.TEAM_MAX_CONCURRENT) || 3;
const EMAIL_DAILY_LIMIT = Number(process.env.TEAM_EMAIL_DAILY_LIMIT) || 100; // customer emails per rolling 24h, whole team
const EMAIL_PER_RECIPIENT_DAILY = 3; // stops the tool being used to spam one inbox
const DAY_MS = 24 * 60 * 60 * 1000;

const emailTimes = []; // timestamps of customer emails in the last 24h
const recipientSends = new Map(); // lowercased address -> timestamps (memory only; never persisted)
const memoryActivity = []; // used only when there is no database (local dev)
const genTimes = []; // timestamps of generations in the last 24h (reserved while in flight)
let inFlight = 0;
let dbPool = null;

const failedLogins = new Map(); // ip -> { count, start }

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

async function ensureTables(pool) {
  dbPool = pool;
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_activity (
        id BIGSERIAL PRIMARY KEY,
        event TEXT NOT NULL,
        rep TEXT,
        props JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS team_activity_created_at_idx ON team_activity (created_at)`);
    const { rows } = await pool.query(`SELECT event, created_at FROM team_activity WHERE event IN ('generate','email') AND created_at > $1 ORDER BY created_at`, [
      new Date(Date.now() - DAY_MS),
    ]);
    for (const r of rows) (r.event === "email" ? emailTimes : genTimes).push(new Date(r.created_at).getTime());
  } catch (err) {
    console.error("[team] could not prepare team_activity table:", err);
  }
}

function logActivity(event, rep, props = {}) {
  if (!dbPool) {
    memoryActivity.push({ event, rep: rep || null, props, t: Date.now() });
    if (memoryActivity.length > 5000) memoryActivity.shift();
    return;
  }
  dbPool
    .query(`INSERT INTO team_activity (event, rep, props) VALUES ($1, $2, $3::jsonb)`, [event, rep || null, JSON.stringify(props)])
    .catch((err) => console.error("[team] failed to log activity:", err));
}

function pruneGenTimes() {
  const cutoff = Date.now() - DAY_MS;
  while (genTimes.length && genTimes[0] < cutoff) genTimes.shift();
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const cleanConceptId = (v) => String(v ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || null;

/** Validates + normalises the concept details a rep submits (used for the PDF, the email and the CRM). */
function readConcept(b, offer) {
  return {
    rep: clean(b.repName, 40),
    customerName: clean(b.customerName, 80),
    address: clean(b.address, 140),
    email: clean(b.customerEmail, 120).toLowerCase(),
    phone: clean(b.customerPhone, 30),
    styleKey: clean(b.styleKey, 30),
    styleLabel: clean(b.styleLabel, 60),
    customized: Boolean(b.customized),
    packageKey: clean(b.packageKey, 30),
    packageName: clean(b.packageName, 60) || null,
    packageFeatures: Array.isArray(b.packageFeatures) ? b.packageFeatures.slice(0, 8).map((f) => clean(f, 40)) : [],
    offer: b.includeOffer ? offer : null,
    notes: clean(b.notes, 500) || null,
    concept: cleanConceptId(b.concept),
    originalImage: b.originalImage,
    renderedImage: b.renderedImage,
  };
}

const conceptReady = (c, b) => Boolean(c.styleLabel) && /^data:image\//.test(String(b.renderedImage ?? ""));

// What the customer (and the CRM note) should see as the design name.
const designName = (c) => (c.customized ? `${c.styleLabel} (customized)` : c.styleLabel);

const pdfOf = (c) =>
  generatePresentationPdf({
    customerName: c.customerName,
    address: c.address,
    repName: c.rep,
    styleLabel: designName(c),
    packageName: c.packageName,
    packageFeatures: c.packageFeatures,
    offer: c.offer,
    notes: c.notes,
    originalImage: c.originalImage,
    renderedImage: c.renderedImage,
  });

const noStore = (res) => res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export function registerTeamRoutes(app, { express, upload, STYLES, generateStyledImage, sharpPromise, pool, offer }) {
  ensureTables(pool);
  const teamDir = path.join(process.cwd(), "team");

  // Public, secret-free front-end files (the pages themselves are gated below).
  app.use("/team/assets", express.static(path.join(teamDir, "assets")));

  app.get("/team", (req, res) => {
    noStore(res);
    if (!teamEnabled()) return res.status(503).type("text").send("The team tool is turned off. Set TEAM_PASSWORD on the server to enable it.");
    res.sendFile(path.join(teamDir, hasTeamSession(req) ? "app.html" : "login.html"));
  });

  app.post("/team/api/login", express.json({ limit: "2kb" }), (req, res) => {
    noStore(res);
    if (!teamEnabled()) return res.status(503).json({ error: "The team tool is turned off." });

    const ip = getClientIp(req);
    const now = Date.now();
    const f = failedLogins.get(ip);
    if (f && now - f.start < 15 * 60 * 1000 && f.count >= 10) {
      return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
    }
    if (passwordMatches(String(req.body?.password ?? ""))) {
      failedLogins.delete(ip);
      startTeamSession(req, res);
      return res.json({ ok: true });
    }
    const cur = f && now - f.start < 15 * 60 * 1000 ? f : { count: 0, start: now };
    cur.count += 1;
    failedLogins.set(ip, cur);
    return res.status(401).json({ error: "That password isn't right." });
  });

  app.post("/team/api/logout", (req, res) => {
    endTeamSession(req, res);
    res.json({ ok: true });
  });

  // Everything below needs a signed-in team member.
  const requireTeam = (req, res, next) => {
    noStore(res);
    if (!hasTeamSession(req)) return res.status(401).json({ error: "Your session expired. Please sign in again.", code: "signed_out" });
    next();
  };

  app.get("/team/api/usage", requireTeam, (req, res) => {
    pruneGenTimes();
    res.json({ used: genTimes.length, limit: DAILY_LIMIT });
  });

  app.post("/team/api/generate", requireTeam, upload.single("image"), async (req, res) => {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
    if (!req.file || !/^image\//.test(req.file.mimetype)) {
      return res.status(400).json({ error: "Please upload a photo (JPG or PNG) of the home." });
    }
    const { buffer, mimetype } = req.file;

    const sharp = await sharpPromise;
    if (sharp) {
      try {
        const meta = await sharp(buffer).metadata();
        if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) {
          return res.status(400).json({ error: "That photo is too small to use. Please upload a regular photo of the home." });
        }
      } catch {
        return res.status(400).json({ error: "We couldn't read that file. Please upload a JPG or PNG photo." });
      }
    }

    pruneGenTimes();
    if (inFlight >= MAX_CONCURRENT) {
      return res.status(503).json({ error: "The design engine is busy with other team members. Try again in a moment." });
    }
    if (genTimes.length >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `The team has reached today's limit of ${DAILY_LIMIT} design generations. It frees up gradually over the next 24 hours.`,
      });
    }

    const rep = clean(req.body?.rep, 40);
    const concept = cleanConceptId(req.body?.concept);
    const now = Date.now();
    genTimes.push(now); // reserve the slot
    inFlight += 1;
    try {
      const settled = await Promise.allSettled(
        STYLES.map((style, i) => new Promise((r) => setTimeout(r, i * 400)).then(() => generateStyledImage(buffer, mimetype, style.description)))
      );
      const results = STYLES.map((style, i) =>
        settled[i].status === "fulfilled"
          ? { key: style.key, label: style.label, image: settled[i].value }
          : { key: style.key, label: style.label, error: settled[i].reason?.message ?? "Failed to generate this style." }
      );
      const ok = results.filter((r) => r.image).length;
      if (ok === 0) {
        const i = genTimes.indexOf(now); // nothing came out — don't charge the team's allowance
        if (i !== -1) genTimes.splice(i, 1);
      } else {
        logActivity("generate", rep, { ok, failed: results.length - ok, concept });
      }
      res.json({ results, used: genTimes.length, limit: DAILY_LIMIT });
    } finally {
      inFlight -= 1;
    }
  });

  app.post("/team/api/presentation", requireTeam, express.json({ limit: "30mb" }), async (req, res) => {
    const b = req.body ?? {};
    const c = readConcept(b, offer);
    if (!conceptReady(c, b)) return res.status(400).json({ error: "Pick a design first." });
    try {
      const pdf = await pdfOf(c);
      logActivity("pdf", c.rep, { style: c.styleKey, package: c.packageKey || "none", offer: Boolean(c.offer), customized: c.customized, concept: c.concept });
      const safe = c.customerName.slice(0, 40).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Customer";
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Blue-Duck-Concept-${safe}.pdf"` });
      res.send(pdf);
    } catch (err) {
      console.error("[team] presentation PDF failed:", err);
      res.status(500).json({ error: "Couldn't build the PDF. Please try again." });
    }
  });

  // Email the presentation to the customer from the tool.
  app.post("/team/api/send-email", requireTeam, express.json({ limit: "30mb" }), async (req, res) => {
    const b = req.body ?? {};
    const c = readConcept(b, offer);
    const repEmail = clean(b.repEmail, 120).toLowerCase();
    if (!conceptReady(c, b)) return res.status(400).json({ error: "Pick a design first." });
    if (!EMAIL_RE.test(c.email)) return res.status(400).json({ error: "Enter the customer's email address first." });
    if (repEmail && !EMAIL_RE.test(repEmail)) return res.status(400).json({ error: "Your own email address doesn't look right." });

    const now = Date.now();
    while (emailTimes.length && emailTimes[0] < now - DAY_MS) emailTimes.shift();
    const mine = (recipientSends.get(c.email) ?? []).filter((t) => t > now - DAY_MS);
    if (emailTimes.length >= EMAIL_DAILY_LIMIT) {
      return res.status(429).json({ error: `The team has sent the maximum of ${EMAIL_DAILY_LIMIT} customer emails for today. Download the PDF and send it yourself.` });
    }
    if (mine.length >= EMAIL_PER_RECIPIENT_DAILY) {
      return res.status(429).json({ error: "That customer has already been emailed several times today. Please try again tomorrow." });
    }

    try {
      const pdfBuffer = await pdfOf(c);
      const sent = await sendConceptEmail({
        to: c.email,
        customerName: c.customerName,
        repName: c.rep,
        repEmail: repEmail || null,
        pdfBuffer,
        styleLabel: designName(c),
        packageName: c.packageName,
        offer: c.offer,
      });
      if (!sent.ok) return res.status(502).json({ error: "The email couldn't be sent. Try again, or download the PDF and email it yourself." });

      emailTimes.push(now);
      recipientSends.set(c.email, [...mine, now]);
      logActivity("email", c.rep, { style: c.styleKey, package: c.packageKey || "none", offer: Boolean(c.offer), customized: c.customized, concept: c.concept });
      res.json({ ok: true });
    } catch (err) {
      console.error("[team] emailing concept failed:", err);
      res.status(500).json({ error: "Couldn't send the email. Please try again." });
    }
  });

  // Save the customer to GoHighLevel (a rep's explicit choice via a checkbox in the tool).
  app.post("/team/api/crm", requireTeam, express.json({ limit: "20kb" }), async (req, res) => {
    const b = req.body ?? {};
    const c = readConcept(b, offer);
    const phoneDigits = c.phone.replace(/\D/g, "");
    if (!c.customerName) return res.status(400).json({ error: "Enter the customer's name to save them to the CRM." });
    if (!EMAIL_RE.test(c.email) && phoneDigits.length < 7) {
      return res.status(400).json({ error: "Enter the customer's email or phone number to save them to the CRM." });
    }
    const result = await syncConceptToCrm({
      name: c.customerName,
      email: EMAIL_RE.test(c.email) ? c.email : null,
      phone: phoneDigits.length >= 7 ? c.phone : null,
      address: c.address,
      rep: c.rep,
      styleLabel: designName(c),
      packageName: c.packageName,
      packageFeatures: c.packageFeatures,
      offer: c.offer,
      notes: c.notes,
      emailed: Boolean(b.emailed),
    });
    logActivity("crm", c.rep, { ok: result.ok, concept: c.concept });
    if (!result.ok) return res.status(502).json({ error: "Couldn't save to the CRM. Let the office know so they can add the customer manually." });
    res.json({ ok: true });
  });
}

/* ---------- team activity report (shown in /admin, "Sales team" tab) ---------- */

const repKey = (name) => String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim() || "(no name)";
const median = (arr) => {
  if (!arr.length) return null;
  const x = [...arr].sort((a, b) => a - b);
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
};
const topList = (map, n = 10) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** rows: [{ event, rep, props, t }] (t = ms). Pure function so it can be tested without a database. */
export function buildTeamReport(rows, { now = Date.now(), days = 30, tz = "America/Indiana/Indianapolis", manualMinutes = null } = {}) {
  const reps = new Map(); // key -> { names: Map, generations, concepts:Set, pdfs, emails, crm, minutes:[] }
  const getRep = (name) => {
    const k = repKey(name);
    if (!reps.has(k)) reps.set(k, { names: new Map(), generations: 0, concepts: new Set(), pdfs: 0, emails: 0, crm: 0, minutes: [] });
    const r = reps.get(k);
    if (name) r.names.set(name, (r.names.get(name) ?? 0) + 1);
    return r;
  };

  const concepts = new Map(); // id -> { rep, firstGen, firstDeliver, last: props }
  let anon = 0;
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const daily = new Map();
  const day = (t) => {
    const d = dayFmt.format(new Date(t));
    if (!daily.has(d)) daily.set(d, { date: d, concepts: new Set(), pdfs: 0, emails: 0 });
    return daily.get(d);
  };

  for (const row of [...rows].sort((a, b) => a.t - b.t)) {
    const r = getRep(row.rep);
    const id = row.props?.concept || `solo-${anon++}`;
    let c = concepts.get(id);
    if (!c && (row.event === "generate" || row.event === "pdf" || row.event === "email")) {
      c = { rep: row.rep, firstGen: null, firstDeliver: null, last: null };
      concepts.set(id, c);
    }
    if (row.event === "generate") {
      r.generations += 1;
      r.concepts.add(id);
      c.firstGen ??= row.t;
      day(row.t).concepts.add(id);
    } else if (row.event === "pdf" || row.event === "email") {
      r[row.event === "pdf" ? "pdfs" : "emails"] += 1;
      r.concepts.add(id);
      c.firstDeliver ??= row.t;
      c.last = row.props;
      day(row.t)[row.event === "pdf" ? "pdfs" : "emails"] += 1;
    } else if (row.event === "crm" && row.props?.ok) {
      r.crm += 1;
    }
  }

  const allMinutes = [];
  const styles = new Map();
  const packages = new Map();
  let delivered = 0;
  let withOffer = 0;
  let customized = 0;
  let savedMinutes = 0; // vs. the office's stated time for a manual concept (only when configured)
  for (const c of concepts.values()) {
    if (!c.firstDeliver) continue;
    delivered += 1;
    if (c.last?.offer) withOffer += 1;
    if (c.last?.customized) customized += 1;
    styles.set(c.last?.style || "unknown", (styles.get(c.last?.style || "unknown") ?? 0) + 1);
    packages.set(c.last?.package || "none", (packages.get(c.last?.package || "none") ?? 0) + 1);
    if (c.firstGen) {
      const min = (c.firstDeliver - c.firstGen) / 60000;
      if (min >= 0 && min <= 240) {
        allMinutes.push(min);
        getRep(c.rep).minutes.push(min);
        if (manualMinutes) savedMinutes += Math.max(0, manualMinutes - min);
      }
    }
  }

  const repRows = [...reps.values()].map((r) => ({
    name: [...r.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(no name)",
    generations: r.generations,
    concepts: r.concepts.size,
    pdfs: r.pdfs,
    emails: r.emails,
    crm: r.crm,
    medianMinutes: r.minutes.length ? Math.round(median(r.minutes) * 10) / 10 : null,
  })).filter((r) => r.generations || r.pdfs || r.emails || r.crm).sort((a, b) => b.concepts - a.concepts);

  const sum = (k) => repRows.reduce((n, r) => n + r[k], 0);
  return {
    generatedAt: new Date(now).toISOString(),
    days,
    totals: {
      concepts: concepts.size,
      delivered,
      generations: sum("generations"),
      pdfs: sum("pdfs"),
      emails: sum("emails"),
      crmAdds: sum("crm"),
      offerPct: pct(withOffer, delivered),
      customizedPct: pct(customized, delivered),
      manualMinutes: manualMinutes || null,
      hoursSaved: manualMinutes && allMinutes.length ? Math.round((savedMinutes / 60) * 10) / 10 : null,
      measuredConcepts: allMinutes.length,
      activeReps: repRows.length,
      medianMinutesToFinish: allMinutes.length ? Math.round(median(allMinutes) * 10) / 10 : null,
    },
    reps: repRows,
    styles: topList(styles),
    packages: topList(packages),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, concepts: d.concepts.size, pdfs: d.pdfs, emails: d.emails })),
  };
}

const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, all: 3650 };

export async function teamReportHandler(req, res) {
  try {
    const days = RANGE_DAYS[String(req.query.range)] ?? 30;
    const since = Date.now() - days * DAY_MS;
    let rows;
    if (dbPool) {
      const r = await dbPool.query(
        `SELECT event, rep, props, (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS t FROM team_activity WHERE created_at >= $1 ORDER BY created_at LIMIT 200000`,
        [new Date(since)]
      );
      rows = r.rows.map((x) => ({ ...x, t: Number(x.t) }));
    } else {
      rows = memoryActivity.filter((x) => x.t >= since);
    }
    res.set("Cache-Control", "no-store");
    res.json(buildTeamReport(rows, { days, manualMinutes: Number(process.env.TEAM_MANUAL_MINUTES) || null }));
  } catch (err) {
    console.error("[team] report failed:", err);
    res.status(500).json({ error: "Could not build the report." });
  }
}
