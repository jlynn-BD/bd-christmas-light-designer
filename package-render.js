import fs from "fs";
import path from "path";
import vm from "vm";

/**
 * Shows a Blue Duck package ON the customer's house.
 *
 * The base AI render only ever has roofline lights (that's a hard rule: trees, driveway and sidewalk
 * lighting are upsells). When a sales rep picks a package, this adds each extra feature the package
 * includes — wreath, trees & shrubs, driveway/walkway stake lights — to the chosen design.
 */

// The package list lives in public/packages.js so the browser and the server always agree on what
// each package includes. Read it here instead of keeping a second copy that could drift.
export function loadPackages() {
  const code = fs.readFileSync(path.join(process.cwd(), "public", "packages.js"), "utf8");
  return vm.runInNewContext(`${code}\n({ PACKAGES, FEATURE_LEGEND })`, {}, { timeout: 1000 });
}

// Plain-language color for lights that should match the chosen style.
const STYLE_COLORS = {
  warm_white: "warm white",
  multicolor: "multicolored (red, green, blue and gold)",
  red_white: "red and white",
  red_green_white: "red, green and white",
};

const STAKES = ["Driveway Stake Lighting", "Sidewalk Stake Lighting"];

// Package features that need drawing (Roofline is already in the base render).
export const extraFeaturesOf = (pkg) => ["Wreath", "Trees and Shrubs", ...STAKES].filter((f) => pkg.features.includes(f));

const KEEP =
  "Keep everything else EXACTLY as it is — the house, porch, railings, steps, windows, doors, the roofline " +
  "lights that are already installed, every tree and plant's shape and position, the lawn, the walkway, and " +
  "the camera angle. Do NOT add, remove, move, reshape, or replace any tree, plant, building, or paving. Keep " +
  "the photo sharp, clean and dark: no blur, no grain or noise, no brightening of the night sky. All new " +
  "lights are small, individual, matte bulbs with a soft realistic glow, like a professional lighting " +
  "company's portfolio photo — never glossy or glassy, never big white globes. Output only the edited image — " +
  "no explanation or caption.";

/**
 * ONE edit that adds every extra the package includes.
 *
 * Tried first as a separate edit per feature, but every pass re-renders the whole picture, so quality
 * drifted with each one: grain, an olive-tinted sky, invented trees and an invented driveway by the
 * third pass. A single pass keeps the original roofline picture clean. Each item still names its likely
 * wrong outcome as WRONG, which is what keeps this model from drifting (see the notes in server.js).
 */
export function buildPackagePrompt(pkg, color) {
  const has = (name) => pkg.features.includes(name);
  const items = [];

  if (has("Wreath")) {
    items.push(
      `WREATH: exactly ONE full green evergreen wreath with a red bow, edged with small ${color} lights, hung ` +
        "on the FRONT DOOR itself (or, only if no front door is visible, the most prominent front-facing " +
        "gable). A common mistake is hanging it on a window or the roof, or adding several wreaths or any " +
        "garland — WRONG and unacceptable. There must be exactly one wreath in the whole photo."
    );
  }

  if (has("Trees and Shrubs")) {
    items.push(
      `TREES: wrap the trunks and main lower branches of ONLY the trees that are already in the photo, exactly as ` +
        `they are — same size, same shape, same position — in neat spiral rows of small, evenly spaced ${color} ` +
        "bulbs. If a tree is small or only partly visible at the edge of the photo, wrap just the part that is " +
        "visible. A common mistake is to grow big new trees, or to make existing trees taller or fuller, so that " +
        "they cover the house or its roofline — WRONG and unacceptable. Never add a tree that is not in the photo."
    );
    items.push(
      `SHRUBS: add a modest, even string of small ${color} bulbs over the shrubs along the front of the house. ` +
        "For both trees and shrubs, every bulb must be a distinct small point of light with the leaves clearly " +
        "visible between the bulbs. A common mistake is to smother the plants in a dense, glittering blanket of " +
        "thousands of tiny lights until the plant disappears and the whole yard glows — WRONG and unacceptable. " +
        "If the photo has no trees or shrubs, add none."
    );
  }

  const stakes = STAKES.filter(has);
  if (stakes.length) {
    const places = [];
    if (stakes.includes("Sidewalk Stake Lighting")) places.push("along both sides of the front walkway that leads to the front door");
    if (stakes.includes("Driveway Stake Lighting")) places.push("along the edges of the driveway, only if a driveway is clearly visible");
    items.push(
      "STAKE LIGHTS: small, evenly spaced landscape path-light stakes (short upright stakes, each with a small " +
        `warm white glowing bulb on top), several along each side, ${places.join(", and ")}. A common mistake is to ` +
        "INVENT a driveway, road, or path that is not in the photo, or to reshape the lawn — WRONG and " +
        "unacceptable; if a place listed is not clearly visible, add no stakes there."
    );
  }

  return (
    "This photo shows a house at night with Christmas lights already along its roofline. Make exactly " +
    `${items.length === 1 ? "this one addition" : "these additions"} and nothing else:\n` +
    items.map((t, i) => `${i + 1}. ${t}`).join("\n") +
    "\n\n" +
    KEEP
  );
}

/**
 * How much the top ~30% of the picture changed between the original and the edited version (0-255
 * scale of grey-level difference, measured on a small copy). The package extras live in the lower part
 * of the photo (door, shrubs, walkway) plus a few edge trees, so a big change up top means the model
 * "helpfully" grew new trees, repainted the sky or hid the roofline — the failure we see in about one
 * run in three. Good renders measured ~6-10; bad ones 18-32.
 */
export async function topRegionDrift(sharp, baseBuffer, editedDataUrl) {
  const W = 160;
  const small = async (buf, w, h) => sharp(buf).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const a = await small(baseBuffer, W, null);
  const edited = Buffer.from(editedDataUrl.split(",")[1], "base64");
  const b = await small(edited, a.info.width, a.info.height);
  const n = Math.floor(a.info.height * 0.3) * a.info.width;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

export const DRIFT_LIMIT = 13; // above this, try again (calibrated on real renders; see topRegionDrift)
const MAX_ATTEMPTS = 3;

/**
 * @param editImage async (buffer, mimeType, prompt) => data URL (jpeg)
 * @param sharp optional — when given, renders that changed the top of the picture too much are retried
 * @returns {{ image: string|null, applied: string[], failed: string[], errorKinds: string[], firstError: string|null }}
 */
export async function renderPackage({ editImage, sharp = null, imageBuffer, mimeType, styleKey, pkg }) {
  const extras = extraFeaturesOf(pkg);
  if (!extras.length) return { image: null, applied: [], failed: [], errorKinds: [], firstError: null };

  const color = STYLE_COLORS[styleKey] ?? "warm white";
  const prompt = buildPackagePrompt(pkg, color);
  let best = null; // { image, drift }
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const image = await editImage(imageBuffer, mimeType, prompt);
      if (!/^data:image\/\w+;base64,/.test(image)) throw new Error("unexpected image format");

      let drift = 0;
      if (sharp) {
        try {
          drift = await topRegionDrift(sharp, imageBuffer, image);
        } catch (err) {
          console.error("[package-render] drift check skipped:", err.message);
        }
      }
      console.log(`[package-render] ${pkg.name} attempt ${attempt}: top-of-picture drift ${drift.toFixed(1)}`);
      if (!best || drift < best.drift) best = { image, drift };
      if (drift <= DRIFT_LIMIT) break; // clean enough
    } catch (err) {
      lastError = err;
      console.error(`[package-render] ${pkg.name} attempt ${attempt} failed:`, err.message);
      // Out of credits / bad key / retired model won't fix itself on a retry.
      if (["billing", "auth", "model"].includes(err.kind)) break;
    }
  }

  if (best) return { image: best.image, applied: extras, failed: [], errorKinds: [], firstError: null, drift: best.drift };
  // Every attempt failed: report every extra as missing so the UI offers a retry.
  return { image: null, applied: [], failed: extras, errorKinds: [lastError?.kind ?? "other"], firstError: lastError?.message ?? null };
}
