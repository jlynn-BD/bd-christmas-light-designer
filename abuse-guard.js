import net from "net";

/**
 * Anti-abuse guardrails for the public app.
 *
 * Threat: a bot hammering the AI image generator (each request = 4 paid Gemini calls) could run up
 * API costs, overload the server, or lock out real customers. Layers, from cheapest to strongest:
 *
 *   1. Per-IP generation quota   - GEN_LIMIT_PER_IP generations per rolling GEN_WINDOW_HOURS
 *                                  (default 5 per 24h), then blocked until the window frees up.
 *   2. Global daily budget       - GEN_GLOBAL_LIMIT generations per window across ALL visitors. This is
 *                                  the hard cost ceiling that still holds against VPN/proxy IP rotation.
 *   3. Concurrency caps          - one in-flight generation per IP, GEN_MAX_CONCURRENT overall, so a
 *                                  burst can't pile up work and starve real customers.
 *   4. Burst limiter             - requests-per-minute caps per IP on generation, lead submission and
 *                                  every other /api route.
 *   5. Allowlist                 - RATE_LIMIT_ALLOWLIST (comma-separated IPs) bypasses the quotas for
 *                                  internal testing. The concurrency cap still applies.
 *
 * State is in memory (this runs as a single instance) and generation history is written through to
 * Postgres, so a redeploy/restart doesn't hand a blocked IP a fresh allowance.
 */

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

const CONFIG = {
  genLimitPerIp: num("GEN_LIMIT_PER_IP", 5),
  genWindowMs: num("GEN_WINDOW_HOURS", 24) * 60 * 60 * 1000,
  genGlobalLimit: num("GEN_GLOBAL_LIMIT", 400),
  genMaxConcurrent: num("GEN_MAX_CONCURRENT", 6),
  genBurstPerMin: num("GEN_BURST_PER_MIN", 10),
  leadsPerHour: num("LEADS_PER_IP_PER_HOUR", 10),
  apiPerMin: num("API_REQUESTS_PER_MIN", 90),
  // How many reverse proxies sit in front of the app and append to X-Forwarded-For (Render + Cloudflare = 2,
  // verified live: chain is "<spoofable>, <real client>, <cloudflare edge>"). The client IP is
  // the entry that many places from the RIGHT (anything further left is client-supplied and spoofable).
  trustedProxyHops: num("TRUSTED_PROXY_HOPS", 2),
};

const SUPPORT_EMAIL = "hello@trustblueduck.com";

/* ---------- client IP ---------- */

// IPv6 users own at least a /64, so bots can trivially rotate addresses inside it. Collapse to the /64.
function expandIpv6(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const missing = 8 - h.length - t.length;
  return [...h, ...Array(ip.includes("::") ? Math.max(missing, 0) : 0).fill("0"), ...t].map((g) => g.padStart(4, "0"));
}

export function normalizeIp(raw) {
  let ip = String(raw ?? "").trim().toLowerCase();
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) return expandIpv6(ip).slice(0, 4).join(":") + "::/64";
  return ip || "unknown";
}

export function getClientIp(req) {
  let ip = null;
  const xff = req.headers["x-forwarded-for"];
  if (xff && CONFIG.trustedProxyHops > 0) {
    const parts = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) ip = parts[Math.max(0, parts.length - CONFIG.trustedProxyHops)];
  }
  return normalizeIp(ip ?? req.socket?.remoteAddress);
}

const ALLOWLIST = new Set(
  String(process.env.RATE_LIMIT_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeIp)
);

export const isAllowlisted = (ip) => ALLOWLIST.has(ip);

/* ---------- helpers ---------- */

function humanDuration(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.ceil(mins / 60);
  return `about ${hrs} hour${hrs === 1 ? "" : "s"}`;
}

function reject(res, status, message, retryAfterMs, extra = {}) {
  if (retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  return res.status(status).json({ error: message, ...extra });
}

// Fixed-window counters for the simple per-minute / per-hour limits.
function makeWindowLimiter({ limit, windowMs, message }) {
  const hits = new Map(); // ip -> { start, count }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (now - h.start > windowMs) hits.delete(ip);
  }, 60 * 1000).unref();

  return function check(ip) {
    if (isAllowlisted(ip)) return null;
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.start > windowMs) {
      h = { start: now, count: 0 };
      hits.set(ip, h);
    }
    h.count += 1;
    if (h.count > limit) {
      const retryMs = h.start + windowMs - now;
      return { retryMs, message: message(retryMs) };
    }
    return null;
  };
}

const warnedAt = new Map();
function logBlock(ip, reason) {
  const key = `${ip}|${reason}`;
  const now = Date.now();
  if (now - (warnedAt.get(key) ?? 0) < 60 * 60 * 1000) return; // one log line per IP+reason per hour
  warnedAt.set(key, now);
  console.warn(`[abuse-guard] blocked ip=${ip} reason=${reason}`);
}

/* ---------- generation quota (per-IP + global + concurrency) ---------- */

const attempts = new Map(); // ip -> number[] timestamps (ms), includes in-flight reservations
let globalAttempts = []; // number[] timestamps (ms)
const inFlightIps = new Set();
let inFlightCount = 0;
let dbPool = null;

export async function initAbuseGuard(pool) {
  dbPool = pool;
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generation_log (
        ip TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS generation_log_created_at_idx ON generation_log (created_at)`);
    await pool.query(`DELETE FROM generation_log WHERE created_at < now() - interval '3 days'`);
    const { rows } = await pool.query(`SELECT ip, created_at FROM generation_log WHERE created_at > $1`, [
      new Date(Date.now() - CONFIG.genWindowMs),
    ]);
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (!attempts.has(r.ip)) attempts.set(r.ip, []);
      attempts.get(r.ip).push(t);
      globalAttempts.push(t);
    }
    console.log(`[abuse-guard] restored ${rows.length} recent generation(s) from the database`);
  } catch (err) {
    console.error("[abuse-guard] could not load generation history (continuing in-memory only):", err);
  }
}

function prune(now) {
  const cutoff = now - CONFIG.genWindowMs;
  globalAttempts = globalAttempts.filter((t) => t > cutoff);
  for (const [ip, list] of attempts) {
    const kept = list.filter((t) => t > cutoff);
    if (kept.length) attempts.set(ip, kept);
    else attempts.delete(ip);
  }
}
setInterval(() => prune(Date.now()), 10 * 60 * 1000).unref();

const genBurst = makeWindowLimiter({
  limit: CONFIG.genBurstPerMin,
  windowMs: 60 * 1000,
  message: () => "You're going a little fast — please wait a minute and try again.",
});

/**
 * Express middleware for POST /api/generate-all. Must run BEFORE multer/body parsing so a rejected
 * request never costs us the upload. Attaches req.abuse = { commit(), refund() }:
 *   - commit(): the upload passed validation and real (paid) generation is about to start.
 *   - refund(): generation produced nothing — give the visitor their attempt back.
 * An attempt that is never committed (invalid upload, bad ZIP, etc.) is released automatically.
 */
export function generationGuard(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const allowlisted = isAllowlisted(ip);

  const burst = genBurst(ip);
  if (burst) {
    logBlock(ip, "generation-burst");
    return reject(res, 429, burst.message, burst.retryMs);
  }

  if (inFlightIps.has(ip)) {
    return reject(res, 429, "Your designs are still being created — please wait for them to finish.", 15000);
  }

  if (inFlightCount >= CONFIG.genMaxConcurrent) {
    logBlock("*", "server-busy");
    return reject(
      res,
      503,
      "A lot of people are creating designs right now. Please try again in a minute.",
      30000
    );
  }

  let myAttempts = [];
  if (!allowlisted) {
    prune(now);
    myAttempts = attempts.get(ip) ?? [];

    if (myAttempts.length >= CONFIG.genLimitPerIp) {
      const retryMs = myAttempts[0] + CONFIG.genWindowMs - now;
      logBlock(ip, "ip-quota");
      return reject(
        res,
        429,
        `You've used all ${CONFIG.genLimitPerIp} of your design previews for today. To keep this tool fast and ` +
          `available for everyone, you can create more in ${humanDuration(retryMs)}. If you'd like help right ` +
          `away, email us at ${SUPPORT_EMAIL} and we'll take care of you.`,
        retryMs,
        { code: "ip_quota" }
      );
    }

    if (globalAttempts.length >= CONFIG.genGlobalLimit) {
      logBlock("*", "global-quota");
      return reject(
        res,
        503,
        `Our design tool is extremely busy and has reached its limit for today. Please check back tomorrow, ` +
          `or email us at ${SUPPORT_EMAIL} and we'll put your design together for you.`,
        60 * 60 * 1000,
        { code: "global_quota" }
      );
    }

    // Reserve the slot immediately so parallel requests can't all slip past the check.
    myAttempts.push(now);
    attempts.set(ip, myAttempts);
    globalAttempts.push(now);
  }

  inFlightIps.add(ip);
  inFlightCount += 1;

  const state = { committed: false, refunded: false };
  req.abuse = {
    ip,
    allowlisted,
    commit() {
      state.committed = true;
    },
    refund() {
      state.refunded = true;
    },
    // Previews left after this one (null for allowlisted IPs, which have no quota).
    remaining() {
      if (allowlisted) return null;
      const used = (attempts.get(ip)?.length ?? 0) + (state.refunded ? -1 : 0);
      return Math.max(0, CONFIG.genLimitPerIp - used);
    },
  };

  let released = false;
  res.on("close", () => {
    if (released) return;
    released = true;
    inFlightIps.delete(ip);
    inFlightCount = Math.max(0, inFlightCount - 1);
    if (allowlisted) return;

    if (!state.committed || state.refunded) {
      const i = myAttempts.indexOf(now);
      if (i !== -1) myAttempts.splice(i, 1);
      if (!myAttempts.length) attempts.delete(ip);
      const g = globalAttempts.indexOf(now);
      if (g !== -1) globalAttempts.splice(g, 1);
      return;
    }

    if (dbPool) {
      dbPool
        .query(`INSERT INTO generation_log (ip, created_at) VALUES ($1, $2)`, [ip, new Date(now)])
        .catch((err) => console.error("[abuse-guard] failed to record generation:", err));
    }
  });

  next();
}

/* ---------- other limiters ---------- */

const leadLimiter = makeWindowLimiter({
  limit: CONFIG.leadsPerHour,
  windowMs: 60 * 60 * 1000,
  message: (ms) =>
    `We've received several requests from your connection recently. Please try again in ${humanDuration(ms)}, ` +
    `or email us at ${SUPPORT_EMAIL}.`,
});

const apiLimiter = makeWindowLimiter({
  limit: CONFIG.apiPerMin,
  windowMs: 60 * 1000,
  message: () => "Too many requests — please slow down and try again in a minute.",
});

export function leadsGuard(req, res, next) {
  const ip = getClientIp(req);
  const hit = leadLimiter(ip);
  if (hit) {
    logBlock(ip, "lead-burst");
    return reject(res, 429, hit.message, hit.retryMs);
  }
  next();
}

// Analytics beacons fire in small batches throughout a visit, and many visitors can share one IP
// (offices, mobile carriers), so they get a roomier limit of their own.
const eventsLimiter = makeWindowLimiter({
  limit: 600,
  windowMs: 60 * 1000,
  message: () => "Too many requests.",
});

/** Blanket per-IP request ceiling for every /api route (cheap protection for ZIP checks etc.). */
export function apiGuard(req, res, next) {
  const ip = getClientIp(req);
  if (req.path === "/events") {
    const burst = eventsLimiter(ip);
    if (burst) return res.status(429).end();
    return next();
  }
  const hit = apiLimiter(ip);
  if (hit) {
    logBlock(ip, "api-burst");
    return reject(res, 429, hit.message, hit.retryMs);
  }
  next();
}

export const GUARD_CONFIG = CONFIG;
