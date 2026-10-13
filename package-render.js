import fs from "fs";
import path from "path";
import vm from "vm";

/**
 * Shows a Blue Duck package ON the customer's house.
 *
 * The base AI render only ever has roofline lights (that's a hard rule: trees, driveway and sidewalk
 * lighting are upsells). When a sales rep picks a package, this adds each extra feature the package
 * includes as its own small, single-purpose edit of the picture — wreath, trees & shrubs, driveway
 * stakes, sidewalk stakes. One feature per edit is deliberate: combined instructions made the image
 * model drop or mangle parts (see the rendering notes in server.js), and the package hero images
 * were fixed the same way.
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

const HEAD =
  "This photo shows a house at night that already has Christmas lights along its roofline. Make exactly ONE " +
  "kind of change, described below, and nothing else.\n\n";

const TAIL =
  "\n\nKeep everything else EXACTLY as it is: do not change, move, add, remove, recolor, or re-render the " +
  "existing roofline lights, the house, the sky, the landscaping, or the camera angle. Do not add snow, " +
  "text, people, or any decoration other than what is described above. Any new lights must be small, " +
  "individual, matte bulbs with a soft realistic glow — a common mistake is glossy, glassy, cartoon-like " +
  "bulbs, which is WRONG and unacceptable — as in a professional lighting company's portfolio photo. " +
  "Output only the edited image — no explanation or caption.";

// One entry per package feature that needs drawing (Roofline is already in the base render).
const FEATURES = {
  Wreath: (color) =>
    `Add exactly ONE Christmas wreath: a full, round, green evergreen wreath with a red bow, edged with small ${color} lights, ` +
    "hung on the front of the house — centered on or directly above the FRONT DOOR if it is clearly visible, " +
    "otherwise on the most prominent front-facing gable or window. A common mistake is adding several " +
    "wreaths, wreaths on every window, garland, or ribbon — that is WRONG and unacceptable. There must be " +
    "exactly one wreath in the whole photo.",

  "Trees and Shrubs": (color) =>
    `Add ${color} Christmas lights to the TREES and SHRUBS in the yard that are already in the photo: wrap each ` +
    "prominent tree's trunk and main lower branches in neat spiral rows of small lights, and lightly cover the " +
    "shrubs and bushes along the front of the house with small lights. Use only trees and shrubs that already " +
    "exist — do not add, remove, or move any plants. A common mistake is to light just one tree or to skip the " +
    "shrubs — every prominent tree and the shrubs along the front of the house should be lit. Another common " +
    "mistake is to add lights to the lawn, walkway, driveway, or the house itself — that is WRONG; only the " +
    "plants get new lights. If the photo has no trees or shrubs at all, return the image unchanged.",

  "Driveway Stake Lighting": () =>
    "Add driveway stake lights: a single row of small, evenly spaced landscape path-light stakes (short upright " +
    "stakes, each with a small warm white glowing bulb on top) along the edge of the DRIVEWAY, following the " +
    "driveway edge from the garage toward the street. Space them evenly like a professional installation. " +
    "A common mistake is placing stake lights randomly on the lawn, along the house wall, on the roof, or along " +
    "the front walkway — that is WRONG and unacceptable; only the driveway edge. If the photo has no visible " +
    "driveway, return the image unchanged.",

  "Sidewalk Stake Lighting": () =>
    "Add sidewalk stake lights: a single row of small, evenly spaced landscape path-light stakes (short upright " +
    "stakes, each with a small warm white glowing bulb on top) along the edges of the front WALKWAY / sidewalk " +
    "that leads to the front door. Space them evenly like a professional installation. A common mistake is " +
    "placing stake lights randomly on the lawn, along the house wall, on the roof, or along the driveway — that " +
    "is WRONG and unacceptable; only the walkway to the door. If the photo has no visible walkway, return the " +
    "image unchanged.",
};

// Order matters a little: the wreath goes on first, plants next, ground-level stakes last.
const ORDER = ["Wreath", "Trees and Shrubs", "Driveway Stake Lighting", "Sidewalk Stake Lighting"];

export const extraFeaturesOf = (pkg) => ORDER.filter((f) => pkg.features.includes(f));

/**
 * @param editImage async (buffer, mimeType, prompt) => data URL (jpeg)
 * @returns {{ image: string, applied: string[], failed: string[] }}
 */
export async function renderPackage({ editImage, imageBuffer, mimeType, styleKey, pkg }) {
  const color = STYLE_COLORS[styleKey] ?? "warm white";
  let buffer = imageBuffer;
  let mime = mimeType;
  let current = null;
  const applied = [];
  const failed = [];
  const errorKinds = []; // see classifyAiError() in image-edit.js
  let firstError = null;

  for (const feature of extraFeaturesOf(pkg)) {
    try {
      const dataUrl = await editImage(buffer, mime, HEAD + FEATURES[feature](color) + TAIL);
      const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
      if (!m) throw new Error("unexpected image format");
      mime = m[1];
      buffer = Buffer.from(m[2], "base64");
      current = dataUrl;
      applied.push(feature);
    } catch (err) {
      // Keep going with whatever we have so one flaky step doesn't throw away the others.
      console.error(`[package-render] "${feature}" failed:`, err.message);
      failed.push(feature);
      errorKinds.push(err.kind ?? "other");
      firstError ??= err.message;
    }
  }

  return { image: current, applied, failed, errorKinds, firstError };
}
