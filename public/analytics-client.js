// Anonymous journey tracking. Sends tiny events (what happened + non-identifying details such as
// which style or package was picked) so Blue Duck can see where visitors leave. Never sends names,
// emails, phone numbers, addresses or photos. Everything here is best-effort: if anything fails,
// the app carries on exactly as before.
(function () {
  var ENDPOINT = "/api/events";
  var SID_KEY = "bd_sid";
  var FLUSH_MS = 1500;
  var queue = [];
  var timer = null;

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // One id per visit (per tab). If storage is blocked (private mode, some iframes) fall back to memory.
  var sid;
  try {
    sid = sessionStorage.getItem(SID_KEY);
  } catch (e) {}
  if (!sid) {
    sid = uuid();
    try {
      sessionStorage.setItem(SID_KEY, sid);
    } catch (e) {}
  }

  // Staff testing: open the app once with ?internal=1 to keep your own clicks out of the real
  // numbers (and ?internal=0 to switch back). The dashboard hides internal visits by default.
  var internal = false;
  try {
    var m = /[?&]internal=([01])/.exec(location.search);
    if (m) localStorage.setItem("bd_internal", m[1]);
    internal = localStorage.getItem("bd_internal") === "1";
  } catch (e) {}

  function device() {
    var w = window.innerWidth || 1024;
    return w <= 640 ? "phone" : w <= 1024 ? "tablet" : "desktop";
  }

  function referrerHost() {
    try {
      return document.referrer ? new URL(document.referrer).hostname : "";
    } catch (e) {
      return "";
    }
  }

  function flush(useBeacon) {
    if (!queue.length) return;
    var now = Date.now();
    var batch = queue.splice(0, 30);
    var body = JSON.stringify({
      sid: sid,
      device: device(),
      embedded: window.parent !== window,
      referrer: referrerHost(),
      internal: internal || undefined,
      events: batch.map(function (ev) {
        return { e: ev.e, p: ev.p, ago: now - ev.t };
      }),
    });
    try {
      if (useBeacon && navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
    if (queue.length) flush(useBeacon);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      flush(false);
    }, FLUSH_MS);
  }

  window.bdTrack = function (event, props) {
    try {
      queue.push({ e: event, p: props || {}, t: Date.now() });
      if (queue.length >= 10) flush(false);
      else schedule();
    } catch (e) {}
  };

  // When someone leaves or switches away, record where they were and send everything immediately.
  var lastLeave = 0;
  function leaving() {
    if (Date.now() - lastLeave < 1000) return flush(true); // visibilitychange + pagehide often fire together
    lastLeave = Date.now();
    window.bdTrack("page_hidden", { stage: window.bdStage || "unknown" });
    flush(true);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") leaving();
  });
  window.addEventListener("pagehide", leaving);
})();
