import path from "path";
import { getClientIp } from "./abuse-guard.js";
import { teamEnabled, passwordMatches, hasTeamSession, startTeamSession, endTeamSession } from "./team-auth.js";
import { generatePresentationPdf } from "./team-pdf.js";

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
 */

const DAILY_LIMIT = Number(process.env.TEAM_DAILY_LIMIT) || 150; // generations per rolling 24h, whole team
const MAX_CONCURRENT = Number(process.env.TEAM_MAX_CONCURRENT) || 3;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    const { rows } = await pool.query(`SELECT created_at FROM team_activity WHERE event = 'generate' AND created_at > $1`, [new Date(Date.now() - DAY_MS)]);
    for (const r of rows) genTimes.push(new Date(r.created_at).getTime());
  } catch (err) {
    console.error("[team] could not prepare team_activity table:", err);
  }
}

function logActivity(event, rep, props = {}) {
  if (!dbPool) return;
  dbPool
    .query(`INSERT INTO team_activity (event, rep, props) VALUES ($1, $2, $3::jsonb)`, [event, rep || null, JSON.stringify(props)])
    .catch((err) => console.error("[team] failed to log activity:", err));
}

function pruneGenTimes() {
  const cutoff = Date.now() - DAY_MS;
  while (genTimes.length && genTimes[0] < cutoff) genTimes.shift();
}

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
        logActivity("generate", rep, { ok, failed: results.length - ok });
      }
      res.json({ results, used: genTimes.length, limit: DAILY_LIMIT });
    } finally {
      inFlight -= 1;
    }
  });

  app.post("/team/api/presentation", requireTeam, express.json({ limit: "30mb" }), async (req, res) => {
    const b = req.body ?? {};
    const styleLabel = clean(b.styleLabel, 60);
    if (!styleLabel || !/^data:image\//.test(String(b.renderedImage ?? ""))) {
      return res.status(400).json({ error: "Pick a design first." });
    }
    const rep = clean(b.repName, 40);
    try {
      const pdf = await generatePresentationPdf({
        customerName: clean(b.customerName, 80),
        address: clean(b.address, 140),
        repName: rep,
        styleLabel,
        packageName: clean(b.packageName, 60) || null,
        packageFeatures: Array.isArray(b.packageFeatures) ? b.packageFeatures.slice(0, 8).map((f) => clean(f, 40)) : [],
        offer: b.includeOffer ? offer : null,
        notes: clean(b.notes, 500) || null,
        originalImage: b.originalImage,
        renderedImage: b.renderedImage,
      });
      logActivity("pdf", rep, { style: clean(b.styleKey, 30), package: clean(b.packageKey, 30) || "none", offer: Boolean(b.includeOffer) });
      const safe = clean(b.customerName, 40).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Customer";
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Blue-Duck-Concept-${safe}.pdf"` });
      res.send(pdf);
    } catch (err) {
      console.error("[team] presentation PDF failed:", err);
      res.status(500).json({ error: "Couldn't build the PDF. Please try again." });
    }
  });
}
