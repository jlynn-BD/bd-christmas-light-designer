const headerPromo = document.getElementById("headerPromo");
const controlsPanel = document.getElementById("controlsPanel");
const fileInput = document.getElementById("fileInput");
const uploadLabel = document.getElementById("uploadLabel");
const originalImg = document.getElementById("originalImg");
const generateBtn = document.getElementById("generateBtn");
const statusMsg = document.getElementById("statusMsg");
const styleGrid = document.getElementById("styleGrid");
const appContent = document.getElementById("appContent");

// Anonymous funnel tracking (analytics-client.js). Safe no-ops if the tracker didn't load.
const track = (event, props) => {
  if (window.bdTrack) window.bdTrack(event, props);
};
let currentStepKey = null;
function setStage(stage) {
  window.bdStage = stage;
}
setStage("zip");

const STEP_ORDER = ["design", "confirm", "lighting", "package", "quote"];
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressSteps = document.getElementById("progressSteps");

function setProgressStep(stepKey) {
  const idx = STEP_ORDER.indexOf(stepKey);
  if (idx === -1) return;
  currentStepKey = stepKey;
  setStage(stepKey);

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

// Every step change must land at the top of the screen. Two things made this unreliable on
// phones: smooth scrolling gets cancelled by iOS Safari when the layout shrinks mid-animation,
// and inside the embedded iframe (sized to its full content) scrolling the iframe's own window
// does nothing — the parent page has to scroll the iframe back into view instead.
function scrollToY(y = 0) {
  const jump = () => {
    window.scrollTo(0, y);
    document.documentElement.scrollTop = y;
    document.body.scrollTop = y;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "blueduck-widget-scroll-top", offset: y }, "*");
    }
  };
  jump();
  requestAnimationFrame(() => requestAnimationFrame(jump));
}

function scrollToTop() {
  scrollToY(0);
}

function scrollToElement(el, margin = 12) {
  scrollToY(Math.max(0, el.getBoundingClientRect().top + window.scrollY - margin));
}

function isPhone() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function hideAllStepPanels() {
  controlsPanel.hidden = true;
  styleGrid.hidden = true;
  approvalPanel.hidden = true;
  customizePanel.hidden = true;
  packagePanel.hidden = true;
  leadPanel.hidden = true;
}

function showDesign() {
  hideAllStepPanels();
  controlsPanel.hidden = false;
  styleGrid.hidden = false;
  setProgressStep("design");
  track("step_reached", { step: "design" });
  scrollToTop();
}

function showConfirm() {
  if (!chosenStyle) return;
  hideAllStepPanels();
  approvalImg.src = chosenStyle.image;
  approvalPanel.hidden = false;
  setProgressStep("confirm");
  track("step_reached", { step: "confirm" });
  scrollToTop();
}

function showLighting() {
  if (!chosenStyle) return;
  hideAllStepPanels();
  decorBaseImg.src = chosenStyle.baseImage;
  customizePanel.hidden = false;
  setProgressStep("lighting");
  track("step_reached", { step: "lighting" });
  scrollToTop();
}

function showPackage() {
  hideAllStepPanels();
  packagePanel.hidden = false;
  setProgressStep("package");
  track("step_reached", { step: "package" });
  track("package_viewed");
  scrollToTop();
}

function showQuote() {
  hideAllStepPanels();
  leadPanel.hidden = false;
  setProgressStep("quote");
  track("step_reached", { step: "quote" });
  track("lead_form_viewed");
  scrollToTop();
}

const CONTACT_PREFERENCE_COPY = {
  call: "A member of our design team will reach out by phone shortly to walk you through your options.",
  quote_only: "You'll receive your personalized estimate by email shortly — no call needed.",
};

function showThankYou(contactPreference) {
  hideAllStepPanels();
  progressBar.hidden = true;

  thankYouNextStep.textContent =
    CONTACT_PREFERENCE_COPY[contactPreference] ??
    "You'll receive your personalized estimate by email, or a member of our design team will contact you shortly.";

  thankYouSummary.textContent = chosenStyle
    ? `You chose ${chosenStyle.label}${chosenPackage ? ` — ${chosenPackage.name}` : ""}.`
    : "";

  thankYouPanel.hidden = false;
  setStage("thank_you");
  scrollToTop();
}

function goToStep(stepKey) {
  track("went_back", { from: currentStepKey || "unknown", to: stepKey });
  if (stepKey === "design") {
    document.querySelectorAll(".style-card.selected").forEach((el) => el.classList.remove("selected"));
    chosenStyle = null;
    showDesign();
  } else if (stepKey === "confirm" && chosenStyle) {
    showConfirm();
  } else if (stepKey === "lighting" && chosenStyle) {
    showLighting();
  } else if (stepKey === "package" && chosenStyle) {
    showPackage();
  }
}

progressSteps.addEventListener("click", (e) => {
  const stepEl = e.target.closest(".progress-step");
  if (!stepEl || !stepEl.classList.contains("completed")) return;
  goToStep(stepEl.dataset.step);
});

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

const thankYouPanel = document.getElementById("thankYouPanel");
const thankYouNextStep = document.getElementById("thankYouNextStep");
const thankYouSummary = document.getElementById("thankYouSummary");

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
const packageContinueTopBtn = document.getElementById("packageContinueTopBtn");
const backToApprovalBtn = document.getElementById("backToApprovalBtn");
const backToPackageBtn = document.getElementById("backToPackageBtn");
const chosenPackageLabel = document.getElementById("chosenPackageLabel");

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

// Decoration editor (wreath / bow / lights / candy cane) is shared with the sales tool: see decor-editor.js.
const decorEditor = createDecorEditor({ wrap: decorCanvasWrap, baseImg: decorBaseImg });

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
      setStage("property_type");
      track("zip_in_area", { zip });
      scrollToTop();
    } else {
      track("zip_out_of_area", { zip });
      setGateMsg(
        `Sorry, we don't currently service ZIP code ${zip}. Blue Duck Christmas Lights serves the greater ` +
          "Indianapolis area — feel free to try another ZIP or check back as we grow!",
        true
      );
    }
  } catch {
    track("zip_check_failed");
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
  document.body.classList.add("in-wizard");
  progressBar.hidden = false;
  thankYouPanel.hidden = true;
  track("property_chosen", { type: "residential" });
  setProgressStep("design");
  track("step_reached", { step: "design" });
  scrollToTop();
});

commercialBtn.addEventListener("click", () => {
  propertyTypePanel.hidden = true;
  commercialPanel.hidden = false;
  headerPromo.hidden = true;
  setStage("commercial_form");
  track("property_chosen", { type: "commercial" });
  track("commercial_form_viewed");
  scrollToTop();
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
        website: document.getElementById("commWebsite").value,
        propertyType: "commercial",
      }),
    });

    const data = await readJson(res);
    if (!res.ok) {
      const failure = new Error(data.error || "Failed to submit your request.");
      failure.status = res.status;
      throw failure;
    }

    commercialForm.hidden = true;
    track("commercial_submitted");
    setCommMsg(
      "🎉 Thank you! Your information has been submitted. A member of the Blue Duck Christmas Lights team " +
        "will contact you shortly to schedule your consultation."
    );
    scrollToTop();
  } catch (err) {
    track("submit_failed", { type: "commercial", reason: failureReason(err) });
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
  chosenStyle = { key: style.key, label: style.label, image: img.src, baseImage: img.src, customized: false };
  track("design_chosen", { style: style.key });

  decorEditor.clear();

  showConfirm();
}

thumbsUpBtn.addEventListener("click", () => {
  if (!chosenStyle) return;
  track("design_loved");
  openPackagePanel();
});

thumbsDownBtn.addEventListener("click", () => {
  if (!chosenStyle) return;
  track("customize_started");
  openCustomizePanel();
});

backToStylesBtn.addEventListener("click", () => {
  goToStep("design");
});

function openPackagePanel() {
  chosenPackage = null;
  packageContinueBtn.disabled = true;
  packageContinueTopBtn.hidden = true;
  packageHeroImg.src = DEFAULT_PACKAGE_HERO_IMAGE;
  renderPackageCards();
  showPackage();
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
  track("package_selected", { package: pkg.key });
  packageContinueBtn.disabled = false;
  packageContinueTopBtn.hidden = false;
  packageContinueTopBtn.textContent = `Continue with ${pkg.name} →`;
  if (pkg.heroImage) packageHeroImg.src = pkg.heroImage;

  // On a phone the cards sit below the image, so the new image would change out of sight.
  // Bring it into view, with the Continue button right underneath.
  if (isPhone()) scrollToElement(packageHeroImg.parentElement, 12);
}

packageContinueBtn.addEventListener("click", () => {
  if (!chosenPackage) return;
  revealLeadPanel();
});

packageContinueTopBtn.addEventListener("click", () => packageContinueBtn.click());

backToApprovalBtn.addEventListener("click", () => {
  goToStep(chosenStyle && chosenStyle.customized ? "lighting" : "confirm");
});

backToConfirmBtn.addEventListener("click", () => {
  goToStep("confirm");
});

backToPackageBtn.addEventListener("click", () => {
  goToStep("package");
});

function revealLeadPanel() {
  if (!chosenStyle) return;
  chosenStyleLabel.textContent = chosenStyle.label + (chosenStyle.customized ? " (customized by you)" : "");
  chosenPackageLabel.textContent = chosenPackage ? `${chosenPackage.name} (${chosenPackage.features.join(", ")})` : "";
  leadForm.hidden = false;
  setLeadMsg("");
  showQuote();
}

function openCustomizePanel() {
  decorEditor.clear();
  showLighting();
}

document.querySelectorAll(".decor-add-btn").forEach((btn) => {
  btn.addEventListener("click", () => decorEditor.add(btn.dataset.decor));
});

customizeResetBtn.addEventListener("click", () => {
  decorEditor.clear();
});

customizeDoneBtn.addEventListener("click", async () => {
  customizeDoneBtn.disabled = true;
  try {
    const flattened = await decorEditor.flatten();
    chosenStyle.image = flattened;
    chosenStyle.customized = true;
    track("customize_done", { count: decorEditor.count() });
    openPackagePanel();
  } catch {
    alert("Something went wrong applying your decorations. Please try again.");
  } finally {
    customizeDoneBtn.disabled = false;
  }
});

leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!chosenStyle) return;

  leadSubmitBtn.disabled = true;
  setLeadMsg("Submitting...");

  const contactPreference = leadForm.querySelector('input[name="contactPreference"]:checked')?.value ?? null;

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
        website: document.getElementById("leadWebsite").value,
        propertyType: "residential",
        contactPreference,
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

    const data = await readJson(res);
    if (!res.ok) {
      const failure = new Error(data.error || "Failed to submit your request.");
      failure.status = res.status;
      throw failure;
    }

    track("lead_submitted", {
      contactPreference: contactPreference || "none",
      style: chosenStyle.key,
      package: chosenPackage ? chosenPackage.key : "none",
      customized: chosenStyle.customized,
    });
    showThankYou(contactPreference);
  } catch (err) {
    track("submit_failed", { type: "residential", reason: failureReason(err) });
    setLeadMsg(err.message, true);
  } finally {
    leadSubmitBtn.disabled = false;
  }
});

function setLeadMsg(message, isError = false) {
  leadMsg.textContent = message;
  leadMsg.classList.toggle("error", isError);
}

// Phone photos are routinely 4-12MB, which is slow (and fragile) to upload over cellular, and
// iPhone photos carry rotation metadata. Redraw to a sensible size, which also bakes in the
// correct orientation. If the browser can't decode the file (e.g. HEIC outside Safari), fall
// back to uploading the original untouched.
async function downscaleImage(file, maxDim = 2048, quality = 0.9) {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);

    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

fileInput.addEventListener("change", async () => {
  const original = fileInput.files[0];
  if (!original) return;

  generateBtn.disabled = true;
  uploadLabel.textContent = "Preparing your photo…";
  const file = await downscaleImage(original);

  selectedFile = file;
  track("photo_selected", { kb: Math.round(file.size / 1024) });
  uploadLabel.textContent = original.name;
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
  decorEditor.clear();
  leadPanel.hidden = true;
  leadForm.hidden = false;
  leadForm.reset();
  setLeadMsg("");
});

generateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  generateBtn.disabled = true;
  const genStartedAt = Date.now();
  track("generate_started");
  setStatus(`🎄 Hanging your lights in ${styles.length} styles... this can take a minute or two.`);
  renderCards("loading");
  startLoadingQuoteRotation();
  if (isPhone()) scrollToElement(statusMsg, 16);

  try {
    const formData = new FormData();
    formData.append("image", selectedFile);
    formData.append("zip", verifiedZip ?? "");

    const response = await fetch("/api/generate-all", {
      method: "POST",
      body: formData,
    });

    const data = await readJson(response);

    if (!response.ok) {
      const failure = new Error(data.error || "Failed to generate previews.");
      failure.status = response.status;
      failure.code = data.code;
      throw failure;
    }

    for (const result of data.results) {
      setCardResult(result.key, result);
    }

    const failures = data.results.filter((r) => r.error).length;
    if (failures < data.results.length) {
      track("generate_completed", { ok: data.results.length - failures, failed: failures, ms: Date.now() - genStartedAt });
    } else {
      track("generate_failed", { reason: "all_failed" });
    }
    let doneMsg =
      failures === 0
        ? "🎉 Your home is ready for the holidays!"
        : `Done — ${data.results.length - failures} of ${data.results.length} styles generated.`;
    // Fair warning before a visitor hits the daily preview limit.
    if (typeof data.previewsRemaining === "number" && data.previewsRemaining <= 2) {
      doneMsg += ` (${data.previewsRemaining} design preview${data.previewsRemaining === 1 ? "" : "s"} left today.)`;
    }
    setStatus(doneMsg);
    if (isPhone() && failures < data.results.length) scrollToElement(statusMsg, 16);
  } catch (err) {
    track("generate_failed", { reason: failureReason(err) });
    setStatus(
      err instanceof TypeError
        ? "We lost your connection while creating your designs — please check your signal and try again."
        : err.message,
      true
    );
    renderCards("idle");
  } finally {
    stopLoadingQuoteRotation();
    generateBtn.disabled = false;
  }
});

// Throttled/overloaded responses can come back from the host as plain text rather than our JSON —
// never let that surface as a cryptic "Unexpected token" error.
// Short, non-identifying label for why a request failed (used only for analytics).
function failureReason(err) {
  if (err instanceof TypeError) return "network";
  if (err && err.code) return err.code;
  if (err && err.status === 429) return "rate_limited";
  if (err && err.status === 503) return "busy";
  if (err && err.status === 400) return "invalid";
  return "error";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {
      error:
        response.status === 429 || response.status === 503
          ? "We're getting a lot of traffic right now — please try again in a minute."
          : "Something went wrong on our end. Please try again.",
    };
  }
}

function setStatus(message, isError = false) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", isError);
}

loadStyles();
setProgressStep("design");
track("app_started");

setupAddressAutocomplete(leadAddress, document.getElementById("leadAddressSuggestions"));
setupAddressAutocomplete(commAddress, document.getElementById("commAddressSuggestions"));

// When embedded in an iframe (e.g. on the main WordPress site), tell the parent page how
// tall the content is so it can resize the iframe instead of showing a nested scrollbar.
if (window.parent !== window) {
  // Measure the body itself: min-height: 100vh and documentElement.scrollHeight both track the
  // iframe's own height, so the iframe could grow but never shrink back.
  document.body.style.minHeight = "0";
  const reportHeight = () => {
    window.parent.postMessage({ type: "blueduck-widget-resize", height: document.body.scrollHeight }, "*");
  };
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener("load", reportHeight);
  reportHeight();
}

// Phones: a keyboard that pops open on page load covers the screen (and inside the embedded
// widget it can yank the host page's scroll position), so only auto-focus on a real desktop.
if (window.parent === window && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  zipInput.focus();
}

if (window.matchMedia("(pointer: coarse)").matches) {
  uploadLabel.textContent = "📸 Tap to upload a photo of your home";
}
