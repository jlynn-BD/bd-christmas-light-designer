// Shared "add wreaths / bows / lights to the design" editor.
// Used by both the customer app (app.js) and the internal sales tool (/team), so the two always
// behave and render identically.
//
//   const editor = createDecorEditor({ wrap: <div .decor-canvas-wrap>, baseImg: <img inside wrap> });
//   editor.add("wreath");          // drop a decoration on the picture
//   editor.count();                // how many are on it now
//   editor.clear();                // remove them all
//   await editor.flatten();        // JPEG data URL of the picture with the decorations burned in

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

function loadImageFromSvg(svgString) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  });
}

function createDecorEditor({ wrap, baseImg }) {
  let decorations = []; // { id, type, xPct, yPct, wPct, hPct, el }
  let idCounter = 0;

  function applyTransform(deco) {
    deco.el.style.left = `${deco.xPct}%`;
    deco.el.style.top = `${deco.yPct}%`;
    deco.el.style.width = `${deco.wPct}%`;
    deco.el.style.height = `${deco.hPct}%`;
  }

  function startDrag(e, deco) {
    const el = deco.el;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");

    function onMove(ev) {
      const rect = wrap.getBoundingClientRect();
      deco.xPct = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
      deco.yPct = Math.min(100, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100));
      applyTransform(deco);
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

  function startResize(e, deco) {
    const el = deco.el;
    e.preventDefault();
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    el.classList.add("resizing");

    const rect = wrap.getBoundingClientRect();
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
      applyTransform(deco);
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

  function add(type) {
    if (!DECOR_SVG[type]) return;
    const id = `decor-${++idCounter}`;
    const jitter = () => 40 + Math.random() * 20;
    const rect = wrap.getBoundingClientRect();
    const size = DECOR_DEFAULT_SIZE[type];
    const deco = {
      id,
      type,
      xPct: jitter(),
      yPct: jitter(),
      wPct: (size.w / rect.width) * 100,
      hPct: (size.h / rect.height) * 100,
    };

    const el = document.createElement("div");
    el.className = `decor-item decor-${type}`;
    el.id = id;
    el.innerHTML = DECOR_SVG[type];
    el.title = DECOR_LABELS[type];
    deco.el = el;
    applyTransform(deco);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "decor-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      decorations = decorations.filter((d) => d !== deco);
      el.remove();
    });
    el.appendChild(removeBtn);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "decor-resize-handle";
    resizeHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      startResize(e, deco);
    });
    el.appendChild(resizeHandle);

    el.addEventListener("pointerdown", (e) => startDrag(e, deco));

    decorations.push(deco);
    wrap.appendChild(el);
  }

  function clear() {
    decorations = [];
    wrap.querySelectorAll(".decor-item").forEach((el) => el.remove());
  }

  async function flatten() {
    const rect = wrap.getBoundingClientRect();
    const scaleX = baseImg.naturalWidth / rect.width;
    const scaleY = baseImg.naturalHeight / rect.height;

    const canvas = document.createElement("canvas");
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

    for (const deco of decorations) {
      const w = deco.el.offsetWidth * scaleX;
      const h = deco.el.offsetHeight * scaleY;
      const centerX = (deco.xPct / 100) * canvas.width;
      const centerY = (deco.yPct / 100) * canvas.height;
      const img = await loadImageFromSvg(DECOR_SVG[deco.type]);
      ctx.drawImage(img, centerX - w / 2, centerY - h / 2, w, h);
    }

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  return { add, clear, flatten, count: () => decorations.length };
}
