const headerPromo = document.getElementById("headerPromo");
const controlsPanel = document.getElementById("controlsPanel");
const fileInput = document.getElementById("fileInput");
const uploadLabel = document.getElementById("uploadLabel");
const originalImg = document.getElementById("originalImg");
const generateBtn = document.getElementById("generateBtn");
const statusMsg = document.getElementById("statusMsg");
const styleGrid = document.getElementById("styleGrid");
const appContent = document.getElementById("appContent");

const STEP_ORDER = ["design", "confirm", "lighting", "package", "quote"];
const progressLabel = document.getElementById("progressLabel");
const progressSteps = document.getElementById("progressSteps");

function setProgressStep(stepKey) {
  const idx = STEP_ORDER.indexOf(stepKey);
  if (idx === -1) return;

  progressLabel.textContent = `Step ${idx + 1} of ${STEP_ORDER.length}`;

  const stepEls = progressSteps.querySelectorAll(".progress-step");
  stepEls.forEach((el, i) => {
    const completed = i < idx;
    el.classList.toggle("completed", completed);
    el.classList.toggle("active", i === idx);
    el.querySelector(".step-circle").textContent = completed ? "✓" : String(i + 1);
  });

  const connectorEls = progressSteps.querySelectorAll(".progress-connector");
  connectorEls.forEach((el, i) => {
    el.classList.toggle("completed", i < idx);
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const lightbox = document.getElementById("lightbox");
const lightboxBackdrop = document.getElementById("lightboxBackdrop");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxCaption = document.getElementById("lightboxCaption");
const lightboxClose = document.getElementById("lightboxClose");

function openLightbox(src, caption) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightbox.hidden = false;
}

function closeLightbox() {
  lightbox.hidden = true;
}

lightboxBackdrop.addEventListener("click", closeLightbox);
lightboxClose.addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
});

const gatePanel = document.getElementById("gatePanel");
const zipInput = document.getElementById("zipInput");
const zipSubmitBtn = document.getElementById("zipSubmitBtn");
const gateMsg = document.getElementById("gateMsg");

const propertyTypePanel = document.getElementById("propertyTypePanel");
const residentialBtn = document.getElementById("residentialBtn");
const commercialBtn = document.getElementById("commercialBtn");

const commercialPanel = document.getElementById("commercialPanel");
const commercialForm = document.getElementById("commercialForm");
const commName = document.getElementById("commName");
const commAddress = document.getElementById("commAddress");
const commPhone = document.getElementById("commPhone");
const commEmail = document.getElementById("commEmail");
const commSubmitBtn = document.getElementById("commSubmitBtn");
const commMsg = document.getElementById("commMsg");

const leadPanel = document.getElementById("leadPanel");
const chosenStyleLabel = document.getElementById("chosenStyleLabel");
const leadForm = document.getElementById("leadForm");
const leadName = document.getElementById("leadName");
const leadAddress = document.getElementById("leadAddress");
const leadPhone = document.getElementById("leadPhone");
const leadEmail = document.getElementById("leadEmail");
const leadSubmitBtn = document.getElementById("leadSubmitBtn");
const leadMsg = document.getElementById("leadMsg");

function setupAddressAutocomplete(inputEl, listEl) {
  let debounceTimer = null;
  let activeController = null;
  let activeIndex = -1;

  inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value.trim();
    activeIndex = -1;

    if (query.length < 4) {
      hideSuggestions();
      return;
    }

    debounceTimer = setTimeout(() => fetchSuggestions(query), 400);
  });

  inputEl.addEventListener("keydown", (e) => {
    const items = Array.from(listEl.querySelectorAll("li"));
    if (listEl.hidden || items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightActive(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlightActive(items);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].click();
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target !== inputEl && !listEl.contains(e.target)) {
      hideSuggestions();
    }
  });

  function highlightActive(items) {
    items.forEach((item, i) => item.classList.toggle("active", i === activeIndex));
  }

  async function fetchSuggestions(query) {
    if (activeController) activeController.abort();
    activeController = new AbortController();

    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=5&countrycodes=us&q=" +
        encodeURIComponent(query);
      const res = await fetch(url, { signal: activeController.signal });
      const results = await res.json();
      renderSuggestions(results);
    } catch (err) {
      if (err.name !== "AbortError") hideSuggestions();
    }
  }

  function renderSuggestions(results) {
    listEl.innerHTML = "";
    if (!Array.isArray(results) || results.length === 0) {
      hideSuggestions();
      return;
    }

    for (const result of results) {
      const li = document.createElement("li");
      li.textContent = result.display_name;
      li.addEventListener("click", () => {
        inputEl.value = result.display_name;
        hideSuggestions();
      });
      listEl.appendChild(li);
    }
    listEl.hidden = false;
  }

  function hideSuggestions() {
    listEl.hidden = true;
    listEl.innerHTML = "";
    activeIndex = -1;
  }
}

const approvalPanel = document.getElementById("approvalPanel");
const approvalImg = document.getElementById("approvalImg");
const thumbsUpBtn = document.getElementById("thumbsUpBtn");
const thumbsDownBtn = document.getElementById("thumbsDownBtn");
const backToStylesBtn = document.getElementById("backToStylesBtn");

const customizePanel = document.getElementById("customizePanel");
const decorCanvasWrap = document.getElementById("decorCanvasWrap");
const decorBaseImg = document.getElementById("decorBaseImg");
const customizeDoneBtn = document.getElementById("customizeDoneBtn");
const customizeResetBtn = document.getElementById("customizeResetBtn");
const backToConfirmBtn = document.getElementById("backToConfirmBtn");

const packagePanel = document.getElementById("packagePanel");
const packageHeroImg = document.getElementById("packageHeroImg");
const packageGrid = document.getElementById("packageGrid");
const packageContinueBtn = document.getElementById("packageContinueBtn");
const backToApprovalBtn = document.getElementById("backToApprovalBtn");
const backToPackageBtn = document.getElementById("backToPackageBtn");
const chosenPackageLabel = document.getElementById("chosenPackageLabel");

const PACKAGES = [
  {
    key: "package1",
    name: "Cousin Eddie Package",
    subtitle: null,
    features: ["Roofline"],
  },
  {
    key: "package2",
    name: "Buddy the Elf",
    subtitle: "Most Popular",
    popular: true,
    features: ["Roofline", "Wreath"],
  },
  {
    key: "package3",
    name: "Santa's Favorite",
    subtitle: null,
    features: ["Roofline", "Wreath", "Trees"],
  },
  {
    key: "package4",
    name: "Clark Griswold Package",
    subtitle: null,
    features: ["Roofline", "Wreath", "Trees", "Driveway Stake Lighting", "Sidewalk Stake Lighting"],
  },
];

const FEATURE_LEGEND = {
  Roofline: { number: 1, color: "#86b83e" },
  Wreath: { number: 2, color: "#e58909" },
  Trees: { number: 3, color: "#663798" },
  "Driveway Stake Lighting": { number: 4, color: "#cd1513" },
  "Sidewalk Stake Lighting": { number: 5, color: "#d99638" },
};

const LOADING_QUOTES = [
  "🎄 Deck the halls, one bulb at a time.",
  "✨ 'Tis the season to twinkle bright.",
  "🎅 Ho ho hold on, magic is loading...",
  "❄️ Making spirits bright, one string at a time.",
  "🔔 Jingle all the way to your rooftop.",
  "🕯️ Warm glows and holiday hopes, coming right up.",
  "🎁 Good things come to those who wait (and decorate).",
  "⭐ Hang your lights with care, hopes for magic soon there.",
  "🦌 Rudolph's guiding your roofline home.",
  "🍪 Better than a plate of cookies: your dream display.",
  "🌟 Wishing you a bright and merry preview.",
  "🎶 Have yourself a merry little wait.",
];

function randomLoadingQuote() {
  return LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)];
}

let loadingQuoteInterval = null;

function startLoadingQuoteRotation() {
  stopLoadingQuoteRotation();
  loadingQuoteInterval = setInterval(() => {
    document.querySelectorAll(".style-placeholder").forEach((el) => {
      el.textContent = randomLoadingQuote();
    });
  }, 4000);
}

function stopLoadingQuoteRotation() {
  if (loadingQuoteInterval) {
    clearInterval(loadingQuoteInterval);
    loadingQuoteInterval = null;
  }
}

let selectedFile = null;
let styles = [];
let verifiedZip = null;
let chosenStyle = null;
let chosenPackage = null;

const DECOR_SVG = {
  wreath:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="none">' +
    '<circle cx="32" cy="30" r="22" fill="none" stroke="#2f7d32" stroke-width="9"/>' +
    '<circle cx="32" cy="30" r="22" fill="none" stroke="#1f5c22" stroke-width="9" stroke-dasharray="3 7"/>' +
    '<path d="M23 46 L32 60 L41 46 L32 51 Z" fill="#c62828"/>' +
    "</svg>",
  bow:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="none">' +
    '<path d="M32 32 L6 14 L6 50 Z" fill="#c62828"/>' +
    '<path d="M32 32 L58 14 L58 50 Z" fill="#c62828"/>' +
    '<circle cx="32" cy="32" r="9" fill="#8e1616"/>' +
    "</svg>",
  lights:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 24" preserveAspectRatio="none">' +
    '<path d="M2 12 Q16 20 32 12 T62 12" fill="none" stroke="#2d4a2d" stroke-width="2"/>' +
    '<circle cx="8" cy="13" r="5" fill="#e63946"/>' +
    '<circle cx="24" cy="16" r="5" fill="#2a9d5c"/>' +
    '<circle cx="40" cy="16" r="5" fill="#f5c842"/>' +
    '<circle cx="56" cy="13" r="5" fill="#4a90d9"/>' +
    "</svg>",
  candycane:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 64" preserveAspectRatio="none">' +
    '<path d="M20 60 V22 A10 10 0 0 0 0 22 V27" stroke="white" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<path d="M20 60 V22 A10 10 0 0 0 0 22 V27" stroke="#c62828" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="7 7"/>' +
    "</svg>",
};

const DECOR_DEFAULT_SIZE = {
  wreath: { w: 56, h: 56 },
  bow: { w: 64, h: 56 },
  lights: { w: 72, h: 27 },
  candycane: { w: 40, h: 56 },
};

const MIN_DECOR_PX = 20;

const DECOR_LABELS = { wreath: "Wreath", bow: "Bow", lights: "Extra Lights", candycane: "Candy Cane" };

let decorations = [];
let decorIdCounter = 0;

zipInput.addEventListener("input", () => {
  zipInput.value = zipInput.value.replace(/\D/g, "").slice(0, 5);
});

zipSubmitBtn.addEventListener("click", checkZip);
zipInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkZip();
});

async function checkZip() {
  const zip = zipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    setGateMsg("Please enter a valid 5-digit ZIP code.", true);
    return;
  }

  zipSubmitBtn.disabled = true;
  setGateMsg("Checking...", false);

  try {
    const res = await fetch("/api/check-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip }),
    });
    const data = await res.json();

    if (data.inServiceArea) {
      verifiedZip = zip;
      gatePanel.hidden = true;
      propertyTypePanel.hidden = false;
    } else {
      setGateMsg(
        `Sorry, we don't currently service ZIP code ${zip}. Blue Duck Christmas Lights serves the greater ` +
          "Indianapolis area — feel free to try another ZIP or check back as we grow!",
        true
      );
    }
  } catch {
    setGateMsg("Something went wrong checking your ZIP code. Please try again.", true);
  } finally {
    zipSubmitBtn.disabled = false;
  }
}

function setGateMsg(message, isError = false) {
  gateMsg.textContent = message;
  gateMsg.classList.toggle("error", isError);
}

residentialBtn.addEventListener("click", () => {
  propertyTypePanel.hidden = true;
  appContent.hidden = false;
  headerPromo.hidden = false;
  setProgressStep("design");
});

commercialBtn.addEventListener("click", () => {
  propertyTypePanel.hidden = true;
  commercialPanel.hidden = false;
  headerPromo.hidden = true;
});

commercialForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  commSubmitBtn.disabled = true;
  setCommMsg("Submitting...");

  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: commName.value.trim(),
        address: commAddress.value.trim(),
        phone: commPhone.value.trim(),
        email: commEmail.value.trim(),
        zip: verifiedZip,
        propertyType: "commercial",
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to submit your request.");

    commercialForm.hidden = true;
    setCommMsg(
      "🎉 Thank you! Your information has been submitted. A member of the Blue Duck Christmas Lights team " +
        "will contact you shortly to schedule your consultation."
    );
  } catch (err) {
    setCommMsg(err.message, true);
  } finally {
    commSubmitBtn.disabled = false;
  }
});

function setCommMsg(message, isError = false) {
  commMsg.textContent = message;
  commMsg.classList.toggle("error", isError);
}

async function loadStyles() {
  const res = await fetch("/api/styles");
  const data = await res.json();
  styles = data.styles;
  renderCards("idle");
}

function renderCards(state) {
  styleGrid.innerHTML = "";
  for (const style of styles) {
    const card = document.createElement("div");
    card.className = "style-card";
    card.id = `card-${style.key}`;

    const heading = document.createElement("h3");
    heading.textContent = style.label;
    card.appendChild(heading);

    const placeholder = document.createElement("div");
    placeholder.className = "placeholder style-placeholder";
    placeholder.textContent = state === "loading" ? randomLoadingQuote() : "Upload a photo to preview this style";
    card.appendChild(placeholder);

    const img = document.createElement("img");
    img.alt = `${style.label} preview`;
    img.hidden = true;
    img.addEventListener("click", () => openLightbox(img.src, style.label));
    card.appendChild(img);

    const chooseBtn = document.createElement("button");
    chooseBtn.className = "choose-btn";
    chooseBtn.textContent = "✅ Choose This Design";
    chooseBtn.disabled = true;
    chooseBtn.addEventListener("click", () => selectStyle(style, card));
    card.appendChild(chooseBtn);

    styleGrid.appendChild(card);
  }
}

function setCardResult(key, result) {
  const card = document.getElementById(`card-${key}`);
  if (!card) return;

  const placeholder = card.querySelector(".style-placeholder");
  const img = card.querySelector("img");
  const chooseBtn = card.querySelector(".choose-btn");

  if (result.image) {
    img.src = result.image;
    img.hidden = false;
    placeholder.hidden = true;
    chooseBtn.disabled = false;
  } else {
    placeholder.textContent = "Couldn't generate this style — try again.";
    placeholder.hidden = false;
  }
}

function selectStyle(style, card) {
  document.querySelectorAll(".style-card.selected").forEach((el) => el.classList.remove("selected"));
  card.classList.add("selected");

  const img = card.querySelector("img");
  chosenStyle = { key: style.key, label: style.label, image: img.src, customized: false };

  controlsPanel.hidden = true;
  styleGrid.hidden = true;
  leadPanel.hidden = true;
  packagePanel.hidden = true;
  customizePanel.hidden = true;
  approvalImg.src = chosenStyle.image;
  approvalPanel.hidden = false;
  setProgressStep("confirm");
  scrollToTop();
}

thumbsUpBtn.addEventListener("click", () => {
  approvalPanel.hidden = true;
  openPackagePanel();
});

thumbsDownBtn.addEventListener("click", () => {
  approvalPanel.hidden = true;
  openCustomizePanel();
});

backToStylesBtn.addEventListener("click", () => {
  approvalPanel.hidden = true;
  controlsPanel.hidden = false;
  styleGrid.hidden = false;
  document.querySelectorAll(".style-card.selected").forEach((el) => el.classList.remove("selected"));
  chosenStyle = null;
  setProgressStep("design");
  scrollToTop();
});

function openPackagePanel() {
  chosenPackage = null;
  packageContinueBtn.disabled = true;
  packageHeroImg.src = "dream-display.png";
  renderPackageCards();
  packagePanel.hidden = false;
  setProgressStep("package");
  scrollToTop();
}

function renderPackageCards() {
  packageGrid.innerHTML = "";
  for (const pkg of PACKAGES) {
    const card = document.createElement("div");
    card.className = "package-card";
    card.id = `pkg-${pkg.key}`;

    if (pkg.subtitle) {
      const badge = document.createElement("span");
      badge.className = "package-badge";
      badge.textContent = pkg.subtitle;
      card.appendChild(badge);
    }

    const heading = document.createElement("h4");
    heading.textContent = pkg.name;
    card.appendChild(heading);

    const list = document.createElement("ul");
    for (const feature of pkg.features) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = feature;
      li.appendChild(label);

      const legendEntry = FEATURE_LEGEND[feature];
      if (legendEntry) {
        const numBadge = document.createElement("span");
        numBadge.className = "feature-number-badge";
        numBadge.textContent = legendEntry.number;
        numBadge.style.backgroundColor = legendEntry.color;
        li.appendChild(numBadge);
      }

      list.appendChild(li);
    }
    card.appendChild(list);

    card.addEventListener("click", () => selectPackage(pkg, card));
    packageGrid.appendChild(card);
  }
}

function selectPackage(pkg, card) {
  document.querySelectorAll(".package-card.selected").forEach((el) => el.classList.remove("selected"));
  card.classList.add("selected");
  chosenPackage = pkg;
  packageContinueBtn.disabled = false;
}

packageContinueBtn.addEventListener("click", () => {
  if (!chosenPackage) return;
  packagePanel.hidden = true;
  revealLeadPanel();
});

backToApprovalBtn.addEventListener("click", () => {
  packagePanel.hidden = true;
  if (chosenStyle && chosenStyle.customized) {
    customizePanel.hidden = false;
    setProgressStep("lighting");
  } else {
    approvalImg.src = chosenStyle.image;
    approvalPanel.hidden = false;
    setProgressStep("confirm");
  }
  scrollToTop();
});

backToConfirmBtn.addEventListener("click", () => {
  customizePanel.hidden = true;
  approvalImg.src = chosenStyle.image;
  approvalPanel.hidden = false;
  setProgressStep("confirm");
  scrollToTop();
});

backToPackageBtn.addEventListener("click", () => {
  leadPanel.hidden = true;
  packagePanel.hidden = false;
  setProgressStep("package");
  scrollToTop();
});

function revealLeadPanel() {
  chosenStyleLabel.textContent = chosenStyle.label + (chosenStyle.customized ? " (customized by you)" : "");
  chosenPackageLabel.textContent = chosenPackage ? `${chosenPackage.name} (${chosenPackage.features.join(", ")})` : "";
  leadForm.hidden = false;
  leadPanel.hidden = false;
  setLeadMsg("");
  setProgressStep("quote");
  scrollToTop();
}

function openCustomizePanel() {
  decorations = [];
  decorCanvasWrap.querySelectorAll(".decor-item").forEach((el) => el.remove());
  decorBaseImg.src = chosenStyle.image;
  customizePanel.hidden = false;
  setProgressStep("lighting");
  scrollToTop();
}

document.querySelectorAll(".decor-add-btn").forEach((btn) => {
  btn.addEventListener("click", () => addDecoration(btn.dataset.decor));
});

function addDecoration(type) {
  const id = `decor-${++decorIdCounter}`;
  const jitter = () => 40 + Math.random() * 20;
  const rect = decorCanvasWrap.getBoundingClientRect();
  const defaultSize = DECOR_DEFAULT_SIZE[type];
  const deco = {
    id,
    type,
    xPct: jitter(),
    yPct: jitter(),
    wPct: (defaultSize.w / rect.width) * 100,
    hPct: (defaultSize.h / rect.height) * 100,
  };
  decorations.push(deco);

  const el = document.createElement("div");
  el.className = `decor-item decor-${type}`;
  el.id = id;
  el.innerHTML = DECOR_SVG[type];
  el.title = DECOR_LABELS[type];
  applyDecorTransform(deco, el);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "decor-remove";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    decorations = decorations.filter((d) => d.id !== id);
    el.remove();
  });
  el.appendChild(removeBtn);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "decor-resize-handle";
  resizeHandle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    startResize(e, deco, el);
  });
  el.appendChild(resizeHandle);

  el.addEventListener("pointerdown", (e) => startDrag(e, deco, el));

  decorCanvasWrap.appendChild(el);
}

function applyDecorTransform(deco, el) {
  el.style.left = `${deco.xPct}%`;
  el.style.top = `${deco.yPct}%`;
  el.style.width = `${deco.wPct}%`;
  el.style.height = `${deco.hPct}%`;
}

function startDrag(e, deco, el) {
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");

  function onMove(ev) {
    const rect = decorCanvasWrap.getBoundingClientRect();
    let xPct = ((ev.clientX - rect.left) / rect.width) * 100;
    let yPct = ((ev.clientY - rect.top) / rect.height) * 100;
    xPct = Math.min(100, Math.max(0, xPct));
    yPct = Math.min(100, Math.max(0, yPct));
    deco.xPct = xPct;
    deco.yPct = yPct;
    applyDecorTransform(deco, el);
  }

  function onUp(ev) {
    el.releasePointerCapture(ev.pointerId);
    el.classList.remove("dragging");
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
  }

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}

function startResize(e, deco, el) {
  e.preventDefault();
  const handle = e.target;
  handle.setPointerCapture(e.pointerId);
  el.classList.add("resizing");

  const rect = decorCanvasWrap.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const startWpx = (deco.wPct / 100) * rect.width;
  const startHpx = (deco.hPct / 100) * rect.height;

  function onMove(ev) {
    const deltaX = (ev.clientX - startX) * 2;
    const deltaY = (ev.clientY - startY) * 2;
    const newWpx = Math.min(rect.width, Math.max(MIN_DECOR_PX, startWpx + deltaX));
    const newHpx = Math.min(rect.height, Math.max(MIN_DECOR_PX, startHpx + deltaY));
    deco.wPct = (newWpx / rect.width) * 100;
    deco.hPct = (newHpx / rect.height) * 100;
    applyDecorTransform(deco, el);
  }

  function onUp(ev) {
    handle.releasePointerCapture(ev.pointerId);
    el.classList.remove("resizing");
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
}

customizeResetBtn.addEventListener("click", () => {
  decorations = [];
  decorCanvasWrap.querySelectorAll(".decor-item").forEach((el) => el.remove());
});

customizeDoneBtn.addEventListener("click", async () => {
  customizeDoneBtn.disabled = true;
  try {
    const flattened = await flattenDesign();
    chosenStyle.image = flattened;
    chosenStyle.customized = true;
    customizePanel.hidden = true;
    openPackagePanel();
  } catch {
    alert("Something went wrong applying your decorations. Please try again.");
  } finally {
    customizeDoneBtn.disabled = false;
  }
});

function loadImageFromSvg(svgString) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  });
}

async function flattenDesign() {
  const rect = decorCanvasWrap.getBoundingClientRect();
  const scaleX = decorBaseImg.naturalWidth / rect.width;
  const scaleY = decorBaseImg.naturalHeight / rect.height;

  const canvas = document.createElement("canvas");
  canvas.width = decorBaseImg.naturalWidth;
  canvas.height = decorBaseImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(decorBaseImg, 0, 0, canvas.width, canvas.height);

  for (const deco of decorations) {
    const el = document.getElementById(deco.id);
    if (!el) continue;
    const w = el.offsetWidth * scaleX;
    const h = el.offsetHeight * scaleY;
    const centerX = (deco.xPct / 100) * canvas.width;
    const centerY = (deco.yPct / 100) * canvas.height;
    const img = await loadImageFromSvg(DECOR_SVG[deco.type]);
    ctx.drawImage(img, centerX - w / 2, centerY - h / 2, w, h);
  }

  return canvas.toDataURL("image/png");
}

leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!chosenStyle) return;

  leadSubmitBtn.disabled = true;
  setLeadMsg("Submitting...");

  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: leadName.value.trim(),
        address: leadAddress.value.trim(),
        phone: leadPhone.value.trim(),
        email: leadEmail.value.trim(),
        zip: verifiedZip,
        propertyType: "residential",
        styleKey: chosenStyle.key,
        styleLabel: chosenStyle.label,
        customized: chosenStyle.customized,
        packageKey: chosenPackage ? chosenPackage.key : null,
        packageLabel: chosenPackage ? chosenPackage.name : null,
        packageFeatures: chosenPackage ? chosenPackage.features : null,
        originalImage: originalImg.src,
        renderedImage: chosenStyle.image,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to submit your request.");

    leadForm.hidden = true;
    setLeadMsg(
      "🎉 Thank you! Your information has been submitted. A member of the Blue Duck Christmas Lights team " +
        "will contact you shortly to lock in your 50% off first-year offer."
    );
  } catch (err) {
    setLeadMsg(err.message, true);
  } finally {
    leadSubmitBtn.disabled = false;
  }
});

function setLeadMsg(message, isError = false) {
  leadMsg.textContent = message;
  leadMsg.classList.toggle("error", isError);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  selectedFile = file;
  uploadLabel.textContent = file.name;
  generateBtn.disabled = false;

  const reader = new FileReader();
  reader.onload = (e) => {
    originalImg.src = e.target.result;
  };
  reader.readAsDataURL(file);

  renderCards("idle");
  setStatus("");
  setProgressStep("design");

  chosenStyle = null;
  chosenPackage = null;
  approvalPanel.hidden = true;
  customizePanel.hidden = true;
  packagePanel.hidden = true;
  decorations = [];
  decorCanvasWrap.querySelectorAll(".decor-item").forEach((el) => el.remove());
  leadPanel.hidden = true;
  leadForm.hidden = false;
  leadForm.reset();
  setLeadMsg("");
});

generateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  generateBtn.disabled = true;
  setStatus(`🎄 Hanging your lights in ${styles.length} styles... this can take a minute or two.`);
  renderCards("loading");
  startLoadingQuoteRotation();

  try {
    const formData = new FormData();
    formData.append("image", selectedFile);
    formData.append("zip", verifiedZip ?? "");

    const response = await fetch("/api/generate-all", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to generate previews.");
    }

    for (const result of data.results) {
      setCardResult(result.key, result);
    }

    const failures = data.results.filter((r) => r.error).length;
    setStatus(
      failures === 0
        ? "🎉 Your home is ready for the holidays!"
        : `Done — ${data.results.length - failures} of ${data.results.length} styles generated.`
    );
  } catch (err) {
    setStatus(err.message, true);
    renderCards("idle");
  } finally {
    stopLoadingQuoteRotation();
    generateBtn.disabled = false;
  }
});

function setStatus(message, isError = false) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", isError);
}

loadStyles();
setProgressStep("design");

setupAddressAutocomplete(leadAddress, document.getElementById("leadAddressSuggestions"));
setupAddressAutocomplete(commAddress, document.getElementById("commAddressSuggestions"));
