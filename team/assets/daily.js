// Staff "Daily Numbers" page. Aggregates only — no customer names or contact details are ever shown.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n ?? 0).toLocaleString();
const TZ = "America/Indiana/Indianapolis";
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDate = (d, n) => { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10); };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else e[k] = v;
  }
  for (const kid of kids) if (kid != null) e.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return e;
}

// goodWhenUp: true for "more is better" (visits, requests); false for problems (failures); null = neutral.
function tile(value, label, now, before, { goodWhenUp = true, suffix = "", compare = true } = {}) {
  const t = el("div", { class: "tile" }, el("div", { class: "n" }, `${fmt(value)}${suffix}`), el("div", { class: "l" }, label));
  if (compare && before != null) {
    const diff = Math.round((now - before) * 10) / 10;
    const cls = diff === 0 || goodWhenUp === null ? "flat" : (diff > 0) === goodWhenUp ? "up" : "down";
    t.append(el("div", { class: `d ${cls}` }, diff === 0 ? "same as the day before" : `${diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(diff))}${suffix} vs. the day before`));
  }
  return t;
}

function card(title, ...kids) {
  return el("section", { class: "team-card" }, el("h2", {}, title), ...kids);
}

function render(d) {
  const root = $("content");
  root.replaceChildren();
  const label = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  $("dayLabel").textContent = d.isToday
    ? `${label} — today so far (updated ${new Date(d.generatedAt).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}, Indianapolis time)`
    : `${label} — full day (Indianapolis time)`;
  $("dayInput").value = d.date;
  $("nextDay").disabled = d.date >= todayStr();

  const c = d.customers, k = c.kpis, p = d.previous.customers;

  // ----- customers
  root.append(card("Customers on the app",
    el("div", { class: "tiles" },
      tile(k.visits, "Visits", k.visits, p.visits),
      tile(k.submitted, "Requests submitted", k.submitted, p.submitted),
      tile(k.conversionPct, "Of visits became a request", k.conversionPct, p.conversionPct, { suffix: "%" }),
      tile(k.designsGenerated, "Got their AI designs", k.designsGenerated, p.designsGenerated),
      tile(k.outOfAreaTries, "Tried a ZIP outside our area", k.outOfAreaTries, p.outOfAreaTries, { goodWhenUp: null }),
      tile(k.generationFailures, "Design attempts that failed", k.generationFailures, p.generationFailures, { goodWhenUp: false }))));

  // ----- follow-ups
  const f = c.leadsByPreference;
  root.append(card("Follow-ups this day created",
    el("div", { class: "follow" },
      tile(f.call, "Want a call from a designer", 0, null, { compare: false }),
      tile(f.quoteOnly, "Just want a quote emailed", 0, null, { compare: false }),
      tile(k.commercialLeads, "Commercial consultation requests", 0, null, { compare: false })),
    el("p", { class: "note" }, "Names and phone numbers are in the CRM (GoHighLevel), tagged for each request. This page only shows counts.")));

  // ----- hourly
  const maxV = Math.max(...c.hourly.map((h) => h.visits), 1);
  const chart = el("div", { class: "chart" });
  const axis = el("div", { class: "axis" });
  c.hourly.forEach((h) => {
    const col = el("div", { class: "col" + (h.hour === d.currentHour ? " now" : ""), title: `${h.hour % 12 || 12}${h.hour < 12 ? "am" : "pm"}: ${h.visits} visit${h.visits === 1 ? "" : "s"}, ${h.requests} request${h.requests === 1 ? "" : "s"}` });
    col.append(el("div", { class: "bar", style: `height:${(h.visits / maxV) * 100}%` }));
    if (h.requests) col.append(el("div", { class: "req", style: `height:${(h.requests / maxV) * 100}%` }));
    chart.append(col);
    axis.append(el("span", {}, h.hour % 3 === 0 ? `${h.hour % 12 || 12}${h.hour < 12 ? "a" : "p"}` : ""));
  });
  root.append(card("When people show up", chart, axis,
    el("p", { class: "legend" }, `Blue = visits started each hour; green = requests submitted. ${d.isToday ? "The hour in progress is outlined." : ""}`)));

  // ----- funnel
  if (k.visits) {
    const fun = card("Where visitors got to");
    c.funnel.forEach((row) => {
      fun.append(el("div", { class: "frow" },
        el("div", { class: "fhead" }, el("span", {}, row.label), el("span", { class: "num" }, `${fmt(row.count)} · ${row.pctOfStart}%`)),
        el("div", { class: "track" }, el("div", { class: "fill" + (row.key === "submitted" ? " done" : ""), style: `width:${Math.max(row.pctOfStart, 0.5)}%` }))));
    });
    root.append(fun);
  }

  if (c.insights.length) {
    const ul = el("ul", { class: "insights" });
    c.insights.forEach((i) => ul.append(el("li", {}, i)));
    root.append(card("What stands out", ul));
  }

  // ----- team
  const t = d.team.kpis, tp = d.previous.team;
  const team = card("Design Studio (sales team)",
    el("div", { class: "tiles" },
      tile(t.concepts, "Concepts started", t.concepts, tp.concepts),
      tile(t.delivered, "Presentations finished", t.delivered, tp.delivered),
      tile(t.emails, "Emailed to customers", t.emails, tp.emails),
      tile(t.crmAdds, "Saved to the CRM", t.crmAdds, tp.crmAdds)));
  if (d.team.reps.length) {
    const tb = el("tbody");
    d.team.reps.forEach((r) => tb.append(el("tr", {}, el("td", {}, r.name), el("td", { class: "num" }, fmt(r.concepts)), el("td", { class: "num" }, fmt(r.pdfs)), el("td", { class: "num" }, fmt(r.emails)), el("td", { class: "num" }, fmt(r.crm)))));
    team.append(el("table", { class: "reps" }, el("thead", {}, el("tr", {}, el("th", {}, "Rep"), el("th", { class: "num" }, "Concepts"), el("th", { class: "num" }, "PDFs"), el("th", { class: "num" }, "Emailed"), el("th", { class: "num" }, "CRM"))), tb));
  } else {
    team.append(el("p", { class: "note" }, "No Design Studio activity this day."));
  }
  root.append(team);
}

let current = todayStr();
let timer = null;

async function load(date = current) {
  current = date;
  clearTimeout(timer);
  try {
    const res = await fetch(`/team/api/daily?date=${encodeURIComponent(date)}`);
    if (res.status === 401) return location.assign("/team"); // session ended: back to sign-in
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load the numbers.");
    current = data.date;
    render(data);
    // Today's numbers keep moving, so refresh them every minute while the page is open.
    if (data.isToday) timer = setTimeout(() => load(current), 60000);
  } catch (err) {
    $("content").replaceChildren(el("p", { class: "empty" }, err instanceof TypeError ? "Couldn't reach the server — check your connection." : err.message));
  }
}

$("prevDay").addEventListener("click", () => load(shiftDate(current, -1)));
$("nextDay").addEventListener("click", () => load(shiftDate(current, 1)));
$("todayBtn").addEventListener("click", () => load(todayStr()));
$("refreshBtn").addEventListener("click", () => load(current));
$("dayInput").max = todayStr();
$("dayInput").addEventListener("change", (e) => e.target.value && load(e.target.value));
load(todayStr());
