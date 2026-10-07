// Internal sales tool front end. Flow: photo -> generate -> pick a design -> presentation PDF.
// Deliberately loads no analytics script: nothing here may count toward the customer funnel.
const $ = (id) => document.getElementById(id);

const repName = $("repName");
const customerName = $("customerName");
const customerAddress = $("customerAddress");
const fileInput = $("fileInput");
const uploadLabel = $("uploadLabel");
const generateBtn = $("generateBtn");
const statusMsg = $("statusMsg");
const stepPick = $("stepPick");
const stepPresent = $("stepPresent");
const styleGrid = $("styleGrid");
const pdfBtn = $("pdfBtn");
const pdfMsg = $("pdfMsg");

let selectedFile = null;
let originalDataUrl = null;
let chosen = null; // { key, label, image }
let chosenPackage = null;

const STYLE_LABELS = [
  { key: "warm_white", label: "Warm White" },
  { key: "multicolor", label: "Multicolored" },
  { key: "red_white", label: "Red and White" },
  { key: "red_green_white", label: "Red, Green and White" },
];

try {
  repName.value = localStorage.getItem("bd_team_rep") || "";
} catch {}
repName.addEventListener("change", () => {
  try {
    localStorage.setItem("bd_team_rep", repName.value.trim());
  } catch {}
});

function setStatus(el, message, isError = false) {
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function signedOut() {
  location.reload(); // the server shows the sign-in page again
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/* ---------- usage chip ---------- */
async function refreshUsage(data) {
  try {
    const d = data ?? (await (await fetch("/team/api/usage")).json());
    if (typeof d.used === "number") $("usageChip").textContent = `Team designs used in the last 24h: ${d.used} of ${d.limit}`;
  } catch {}
}
refreshUsage();

$("signOutBtn").addEventListener("click", async () => {
  await fetch("/team/api/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

/* ---------- photo ---------- */
// Phone/DSLR photos are big; shrink them (which also bakes in the right rotation) before uploading.
async function downscaleImage(file, maxDim = 2048, quality = 0.9) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

fileInput.addEventListener("change", async () => {
  const original = fileInput.files[0];
  if (!original) return;
  generateBtn.disabled = true;
  uploadLabel.textContent = "Preparing photo…";
  selectedFile = await downscaleImage(original);
  uploadLabel.textContent = original.name;
  originalDataUrl = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.readAsDataURL(selectedFile);
  });
  generateBtn.disabled = false;
  setStatus(statusMsg, "");
  stepPick.hidden = true;
  stepPresent.hidden = true;
  chosen = null;
});

/* ---------- generate ---------- */
function renderCards(state) {
  styleGrid.innerHTML = "";
  for (const s of STYLE_LABELS) {
    const card = document.createElement("div");
    card.className = "style-card";
    card.id = `card-${s.key}`;
    const h = document.createElement("h3");
    h.textContent = s.label;
    card.append(h);
    const ph = document.createElement("div");
    ph.className = "placeholder style-placeholder";
    ph.textContent = state === "loading" ? "Hanging the lights…" : "";
    card.append(ph);
    const img = document.createElement("img");
    img.alt = `${s.label} preview`;
    img.hidden = true;
    img.addEventListener("click", () => openLightbox(img.src));
    card.append(img);
    const btn = document.createElement("button");
    btn.className = "choose-btn";
    btn.textContent = "✅ Choose This Design";
    btn.disabled = true;
    btn.addEventListener("click", () => choose(s, card, img.src));
    card.append(btn);
    styleGrid.append(card);
  }
}

generateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  if (!repName.value.trim()) {
    setStatus(statusMsg, "Please enter your name first, so we know who made this concept.", true);
    repName.focus();
    return;
  }
  generateBtn.disabled = true;
  setStatus(statusMsg, "🎄 Creating the four designs… this takes up to a minute.");
  stepPick.hidden = false;
  stepPresent.hidden = true;
  chosen = null;
  renderCards("loading");
  stepPick.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const fd = new FormData();
    fd.append("image", selectedFile);
    fd.append("rep", repName.value.trim());
    const res = await fetch("/team/api/generate", { method: "POST", body: fd });
    const data = await readJson(res);
    if (res.status === 401) return signedOut();
    if (!res.ok) throw new Error(data.error || "Couldn't generate designs.");

    let ok = 0;
    for (const r of data.results) {
      const card = $(`card-${r.key}`);
      if (!card) continue;
      const ph = card.querySelector(".style-placeholder");
      if (r.image) {
        ok += 1;
        const img = card.querySelector("img");
        img.src = r.image;
        img.hidden = false;
        ph.hidden = true;
        card.querySelector(".choose-btn").disabled = false;
      } else {
        ph.textContent = "Couldn't generate this one — generate again.";
      }
    }
    setStatus(statusMsg, ok === data.results.length ? "✅ Designs ready. Pick one below." : `${ok} of ${data.results.length} designs ready. You can pick one or generate again.`);
    refreshUsage(data);
  } catch (err) {
    stepPick.hidden = true;
    setStatus(statusMsg, err instanceof TypeError ? "Lost the connection — check your signal and try again." : err.message, true);
  } finally {
    generateBtn.disabled = false;
  }
});

/* ---------- pick + present ---------- */
function choose(style, card, imageSrc) {
  document.querySelectorAll(".style-card.selected").forEach((el) => el.classList.remove("selected"));
  card.classList.add("selected");
  chosen = { key: style.key, label: style.label, image: imageSrc };
  $("chosenImg").src = imageSrc;
  $("chosenLabel").textContent = style.label;
  setStatus(pdfMsg, "");
  stepPresent.hidden = false;
  stepPresent.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPackageOptions() {
  const box = $("packageOptions");
  const opts = [{ key: "", name: "No package — just the design", features: [] }, ...PACKAGES];
  for (const p of opts) {
    const label = document.createElement("label");
    label.className = "team-pkg";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "pkg";
    radio.value = p.key;
    radio.checked = p.key === "";
    radio.addEventListener("change", () => (chosenPackage = p.key ? p : null));
    const text = document.createElement("span");
    const name = document.createElement("span");
    name.className = "pk-name";
    name.textContent = p.name;
    text.append(name);
    if (p.features.length) {
      const feat = document.createElement("span");
      feat.className = "pk-feat";
      feat.textContent = p.features.join(" · ");
      text.append(feat);
    }
    label.append(radio, text);
    box.append(label);
  }
}
renderPackageOptions();

pdfBtn.addEventListener("click", async () => {
  if (!chosen) return;
  pdfBtn.disabled = true;
  setStatus(pdfMsg, "Building the PDF…");
  try {
    const res = await fetch("/team/api/presentation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repName: repName.value.trim(),
        customerName: customerName.value.trim(),
        address: customerAddress.value.trim(),
        styleKey: chosen.key,
        styleLabel: chosen.label,
        packageKey: chosenPackage ? chosenPackage.key : "",
        packageName: chosenPackage ? chosenPackage.name : "",
        packageFeatures: chosenPackage ? chosenPackage.features : [],
        includeOffer: $("includeOffer").checked,
        notes: $("notes").value.trim(),
        originalImage: originalDataUrl,
        renderedImage: chosen.image,
      }),
    });
    if (res.status === 401) return signedOut();
    if (!res.ok) throw new Error((await readJson(res)).error || "Couldn't build the PDF.");

    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "Blue-Duck-Concept.pdf";
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setStatus(pdfMsg, `✅ Saved ${name}. Attach it to an email to the customer.`);
  } catch (err) {
    setStatus(pdfMsg, err instanceof TypeError ? "Lost the connection — try again." : err.message, true);
  } finally {
    pdfBtn.disabled = false;
  }
});

/* ---------- lightbox ---------- */
function openLightbox(src) {
  $("lightboxImg").src = src;
  $("lightbox").hidden = false;
}
$("lightbox").addEventListener("click", () => ($("lightbox").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("lightbox").hidden = true;
});
