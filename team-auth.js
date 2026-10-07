import crypto from "crypto";

/**
 * Sign-in for Blue Duck's internal sales tool (/team).
 *
 * One shared team password (TEAM_PASSWORD env var) buys a signed, HTTP-only session cookie that
 * lasts 12 hours. Nothing is stored server-side: the cookie is "<expiry>.<signature>", and the
 * signature is keyed off the team password — so changing TEAM_PASSWORD instantly signs everyone out.
 *
 * With no TEAM_PASSWORD configured the tool is simply switched off.
 */

const COOKIE_NAME = "bd_team";
const SESSION_MS = 12 * 60 * 60 * 1000;

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();

export const teamEnabled = () => Boolean(process.env.TEAM_PASSWORD);

const sign = (expiry) =>
  crypto
    .createHmac("sha256", sha(`bd-team-session:${process.env.TEAM_PASSWORD ?? ""}`))
    .update(String(expiry))
    .digest("hex");

export function passwordMatches(supplied) {
  if (!teamEnabled()) return false;
  return crypto.timingSafeEqual(sha(supplied ?? ""), sha(process.env.TEAM_PASSWORD));
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** True when the request carries a valid, unexpired team session cookie. */
export function hasTeamSession(req) {
  if (!teamEnabled()) return false;
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return false;
  const [expiry, sig] = raw.split(".");
  if (!expiry || !sig || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  const expected = sign(expiry);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const isHttps = (req) => req.secure || String(req.headers["x-forwarded-proto"] ?? "").includes("https");

export function startTeamSession(req, res) {
  const expiry = Date.now() + SESSION_MS;
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${expiry}.${sign(expiry)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? "; Secure" : ""}`
  );
}

export function endTeamSession(req, res) {
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`);
}
