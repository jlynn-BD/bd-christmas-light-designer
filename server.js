import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";
// Loaded lazily: sharp ships a native binary, and if it ever fails to load on the host the app
// must still run — we'd just serve the model's original (larger) PNGs.
const sharpPromise = import("sharp")
  .then((m) => m.default)
  .catch((err) => {
    console.error("sharp unavailable — AI previews will not be compressed:", err);
    return null;
  });
import { generateLeadPdf } from "./lead-pdf.js";
import { sendLeadEmail, sendCustomerConfirmationEmail } from "./lead-email.js";
import { syncLeadToCrm } from "./lead-crm.js";
import { apiGuard, generationGuard, leadsGuard, getClientIp, isAllowlisted, initAbuseGuard } from "./abuse-guard.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LEADS_DIR = path.join(process.cwd(), "leads");
fs.mkdirSync(LEADS_DIR, { recursive: true });

// Local files above are a dev-only convenience — on hosts with an ephemeral filesystem
// (e.g. Render's free tier), leads/ is wiped on every redeploy. When DATABASE_URL is set,
// every lead is also durably persisted to Postgres.
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function ensureLeadsTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      submitted_at TIMESTAMPTZ NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      zip TEXT,
      property_type TEXT,
      style_key TEXT,
      style_label TEXT,
      customized BOOLEAN,
      package_key TEXT,
      package_label TEXT,
      package_features JSONB,
      offer_presented TEXT,
      original_image TEXT,
      rendered_image TEXT
    )
  `);
  // Added after the leads table already existed in production — ALTER is required
  // since CREATE TABLE IF NOT EXISTS above is a no-op once the table is present.
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_preference TEXT`);
}
ensureLeadsTable().catch((err) => console.error("Failed to ensure leads table exists:", err));
initAbuseGuard(pool);

const APPROVED_ZIPS = new Set([
  "46032", "46033", "46034", "46037", "46038", "46040", "46055", "46060", "46062",
  "46074", "46075", "46077", "46106", "46112", "46122", "46123", "46131", "46140",
  "46142", "46143", "46168", "46205", "46208", "46216", "46220", "46224", "46226",
  "46234", "46235", "46236", "46239", "46240", "46250", "46254", "46256", "46260",
  "46268", "46278", "46280", "46290", "47401", "47403", "47404", "47405", "47408",
]);

function isZipInServiceArea(zip) {
  return typeof zip === "string" && APPROVED_ZIPS.has(zip.trim());
}

const CURRENT_OFFER = "50% off Year 1 installation with a signed 3-year service agreement";

const STYLES = [
  { key: "warm_white", label: "Warm White", description: "warm white (soft yellowish) C9 bulbs" },
  {
    key: "multicolor",
    label: "Multicolored",
    description:
      "C9 bulbs in a strict repeating four-bulb sequence: one red bulb, then one green bulb, then one " +
      "blue bulb, then one gold/yellow bulb, continuously repeating in that exact order along the entire " +
      "strand. All four colors must be clearly, vividly visible in equal proportion — do not let red or any " +
      "single color dominate, and do not let any color fade out, blend together, or go missing",
  },
  {
    key: "red_white",
    label: "Red and White",
    description:
      "C9 bulbs in a strict repeating pattern of PAIRS: two white bulbs, then two red bulbs, continuously " +
      "repeating along the entire strand (white, white, red, red, white, white, red, red...). A common " +
      "mistake is to render this as solid red with no white bulbs at all, or to single-alternate one white " +
      "then one red instead of grouping in pairs — both are WRONG and unacceptable. White is not optional or " +
      "decorative here, it is required on every strand in exactly equal amount to red. Count through every " +
      "strand in groups of four and assign each bulb in order: 1st bulb white, 2nd bulb white, 3rd bulb red, " +
      "4th bulb red, repeating this exact 1-2-3-4 count for the entire roofline. The white bulbs must be just " +
      "as bright, saturated, and easy to spot as the red ones — never dim, never skipped, never merged with " +
      "the roofline or fascia color. Before finishing, check every strand on the house: if any stretch shows " +
      "only red with no white, that stretch is wrong and must be corrected",
  },
  {
    key: "red_green_white",
    label: "Red, Green and White",
    description:
      "C9 bulbs in a strict repeating THREE-color sequence — red, green, white, red, green, white — " +
      "repeating continuously along the entire strand. A common mistake is to collapse this into any " +
      "TWO-color pattern and drop the third color entirely — for example red-and-green with no white, " +
      "red-and-white with no green, or green-and-white with no red. ALL THREE of these mistakes are WRONG " +
      "and unacceptable, no matter which two colors end up paired together: red, green, AND white are each " +
      "individually required, none of them is optional or more droppable than the others. Count through " +
      "every strand in groups of three and assign each bulb in order: 1st bulb red, 2nd bulb green, 3rd bulb " +
      "white, 4th bulb red, 5th bulb green, 6th bulb white, repeating this exact 1-2-3 count for the entire " +
      "roofline. Each of the three colors must be just as bright, saturated, and easy to spot as the other " +
      "two — never dim, never skipped, never merged with the roofline or fascia color. Before finishing, " +
      "check every strand on the house: count how many distinct colors appear on it. If any stretch shows " +
      "only two colors instead of all three, that stretch is wrong and must be corrected",
  },
];

app.use(cors());
// Images never change under the same filename, so let phones cache them for a week (the HTML,
// JS and CSS keep default revalidation so deploys show up immediately).
app.use(
  express.static("public", {
    setHeaders(res, filePath) {
      if (/\.(png|jpe?g|webp)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=604800");
      }
    },
  })
);

function buildPrompt(lightDescription) {
  return (
    `Edit this photo of a house to add ${lightDescription} for Christmas, installed exactly the way a ` +
    "professional residential Christmas light company installs a standard roofline (C9 gutter-line) package. " +
    "ONLY add lights along the gutter line / eave edge of the MAIN house roofline — the lower edge of the " +
    "primary structure's gables and dormers, where the fascia and gutter are mounted. " +
    "Cover the ENTIRE main roofline of the house — every gable and dormer of the primary structure, and the " +
    "full length of every eave along those main roof sections visible in the photo. Do not light only one " +
    "gable while leaving other main roof sections dark; a real installation crew lights the entire main " +
    "roofline, not just one section of it. " +
    "This includes both flat horizontal runs of gutter AND sloped/raked sections that follow a gable edge " +
    "diagonally up toward its peak — both count as legitimate gutter line as long as they are the LOWER roof " +
    "edge (where roof meets wall or fascia), not the upper edge. " +
    "Do NOT put lights on the ridge line or hip line — the horizontal or angled line at the very TOP of the " +
    "roof where two roof slopes meet. There is no gutter up there, so it is never a realistic install point. " +
    "Every single bulb must sit on a real, continuous gutter/eave edge that is clearly visible in the photo. " +
    "If you are not certain an edge is the gutter line, leave it unlit. " +
    "\n\nDo NOT add lights anywhere else. This is a strict list of what to leave completely unlit:\n" +
    "- Do NOT add lights to the roof overhang directly above a garage door — the garage roofline must stay " +
    "completely unlit, even though the main house roofline next to it is lit. A common mistake is to draw a " +
    "light strand along the horizontal trim or fascia directly above the garage door opening — that is WRONG " +
    "and unacceptable, even though it looks like a plausible gutter line. That trim line belongs to the " +
    "garage's own separate, lower roof structure and must be left completely bare, with zero bulbs on it. " +
    "IMPORTANT: on houses with an attached garage, there are usually TWO separate roof edges stacked near the " +
    "garage — a LOWER one that is the garage's own roof overhang directly above the garage door opening (leave " +
    "this one completely dark), and a HIGHER one above it at the main house roof eave or gable (light only " +
    "this one). If you find yourself about to place a bulb anywhere above a garage door, stop and check: is " +
    "this bulb on the higher main-roof line, or on the lower garage-door trim? If there is any doubt, do not " +
    "place a bulb there.\n" +
    "- Do NOT add lights to a porch roof, covered entryway, or entry overhang — only the main house roofline " +
    "(the gables and dormers of the primary structure) gets lit, never the porch or entry roof. " +
    "IMPORTANT: on houses with a covered porch, there are usually TWO separate gutter lines stacked at " +
    "different heights — a LOWER one running along the top of the porch support columns/posts (this is the " +
    "porch roofline), and a HIGHER one above it at the main roof eave (this is the main roofline). Only light " +
    "the HIGHER, main-roof gutter line. If you find yourself about to light an edge that runs directly above a " +
    "row of porch columns, stop — that is the porch roofline, and it must stay unlit even though the main " +
    "roofline right above it is lit.\n" +
    "- Do NOT outline windows or window frames.\n" +
    "- Do NOT run lights down gutter downspouts or any vertical drainpipe.\n" +
    "- Do NOT outline the front door or any door frame.\n" +
    "- Do NOT run lights vertically down columns, posts, or porch supports.\n" +
    "- Do NOT add lights to trees.\n" +
    "- Do NOT add lights to bushes, hedges, or other landscaping.\n" +
    "- Do NOT add lights along the sidewalk, driveway, walkway, or as ground stakes.\n" +
    "- Do NOT add any lights that are not directly on the main house roofline.\n\n" +
    "Render the lights as small, individual bulbs, evenly spaced with a visible gap between each bulb — bulbs " +
    "must not touch, overlap, or blend into a solid strip, tube, or rope-light line of color; every bulb stays " +
    "individually visible, the same as every other style. " +
    "Do not apply an overall color tint or filter across the whole photo — each color should be visible only " +
    "on the bulbs themselves, never as a wash over the house, sky, or landscaping. " +
    "Give the lights a realistic warm glow and subtle light bloom, as if photographed at night, well after " +
    "sunset, the way a professional lighting company's portfolio photos look — a dark night sky, not a bright " +
    "dusk sky, so the warm glow of the bulbs stands out with real contrast. A common mistake is to render each " +
    "bulb as a glossy, glassy sphere with a bright specular highlight, like a 3D-rendered icon, clip-art " +
    "ornament, or gumball — that look is WRONG and unacceptable, even though the colors and placement are " +
    "correct. Real C9 bulbs are matte plastic that glow softly from within; they do NOT have a shiny, " +
    "reflective, glass-like highlight on their surface. Every bulb must look matte and softly glowing, not " +
    "glossy or glassy. " +
    "Keep the house structure, landscaping, background, and camera angle exactly the same — only add the " +
    "roofline lights themselves and a natural dark night sky if the original photo was taken in daylight. " +
    "Do not add snow, decorations other than the roofline lights, or text of any kind. " +
    `\n\nBefore finishing, re-check the bulb color pattern against this exact requirement: ${lightDescription}. ` +
    "Look at every strand you have drawn and compare it to that requirement. If any strand is missing a " +
    "required color, uses the wrong ratio, or has silently collapsed into a simpler pattern than what was " +
    "specified, that is wrong — fix it before finishing. " +
    "Also re-check bulb material: if any bulb looks like a shiny, glossy, glass-like sphere with a bright " +
    "reflective highlight, that is wrong — every bulb must look matte and softly glowing instead. " +
    "Output only the edited image — no explanation or caption."
  );
}

async function generateStyledImage(fileBuffer, mimeType, lightDescription) {
  const contents = [
    { text: buildPrompt(lightDescription) },
    {
      inlineData: {
        mimeType,
        data: fileBuffer.toString("base64"),
      },
    },
  ];

  const MAX_ATTEMPTS = 3;
  let imagePart = null;
  let lastTextReply = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !imagePart; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents,
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      imagePart = parts.find((p) => p.inlineData) ?? null;
      lastTextReply = parts.find((p) => p.text)?.text ?? lastTextReply;
    } catch (err) {
      const retryable = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(err.message ?? "");
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;
    }

    if (!imagePart && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  if (!imagePart) {
    throw new Error(lastTextReply ? `Model returned no image: ${lastTextReply}` : "Model returned no image.");
  }

  // The model returns ~2.5-3MB PNGs; four of those is a ~12MB response (and a ~12MB database row
  // per lead) on a phone's cellular connection. A q90 JPEG is visually identical at ~1/7 the size.
  try {
    const sharp = await sharpPromise;
    if (!sharp) throw new Error("sharp not loaded");
    const jpeg = await sharp(Buffer.from(imagePart.inlineData.data, "base64"))
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    console.error("JPEG conversion failed, returning original image:", err);
    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  }
}

// Guards run BEFORE body parsing so a throttled request never costs us the upload/JSON parse.
// Only /api/leads legitimately carries big payloads (the house photo + rendered design as data URLs);
// everything else gets a tiny body limit.
app.use("/api", apiGuard);
app.post("/api/leads", leadsGuard);
app.use("/api/leads", express.json({ limit: "30mb" }));
app.use(express.json({ limit: "20kb" }));

// Echoes back the address the server sees for the caller — handy for finding the IP to add to
// RATE_LIMIT_ALLOWLIST for internal testing. Reveals nothing beyond the caller's own address.
app.get("/api/client-info", (req, res) => {
  const ip = getClientIp(req);
  res.json({ ip, allowlisted: isAllowlisted(ip) });
});

app.get("/api/styles", (req, res) => {
  res.json({ styles: STYLES.map(({ key, label }) => ({ key, label })) });
});

app.post("/api/check-zip", (req, res) => {
  const zip = req.body?.zip;
  res.json({ inServiceArea: isZipInServiceArea(zip) });
});

function saveDataUrlImage(dataUrl, destPathWithoutExt) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  const [, mimeType, base64] = match;
  const ext = mimeType.split("/")[1] || "png";
  const filePath = `${destPathWithoutExt}.${ext}`;
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return path.basename(filePath);
}

app.post("/api/leads", async (req, res) => {
  const body = req.body ?? {};

  // Honeypot: real visitors never see or fill this hidden field, bots usually do. Pretend it
  // worked so the bot doesn't learn anything, but save nothing and notify nobody.
  if (String(body.website ?? "").trim()) {
    console.warn(`[abuse-guard] honeypot tripped ip=${getClientIp(req)}`);
    return res.json({ ok: true, leadId: "ok" });
  }

  const requiredFields = ["name", "address", "phone", "email"];
  const missing = requiredFields.filter((f) => !String(body[f] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }
  if (requiredFields.some((f) => String(body[f]).length > 300)) {
    return res.status(400).json({ error: "One of the fields you entered is too long." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (String(body.phone).replace(/\D/g, "").length < 7) {
    return res.status(400).json({ error: "Please enter a valid phone number." });
  }

  const leadId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const leadDir = path.join(LEADS_DIR, leadId);
  fs.mkdirSync(leadDir, { recursive: true });

  const originalPhoto = saveDataUrlImage(body.originalImage, path.join(leadDir, "original"));
  const renderedPhoto = saveDataUrlImage(body.renderedImage, path.join(leadDir, "rendered"));

  const propertyType = body.propertyType === "commercial" ? "commercial" : "residential";
  const contactPreference = ["call", "quote_only"].includes(body.contactPreference) ? body.contactPreference : null;

  const record = {
    id: leadId,
    submittedAt: new Date().toISOString(),
    name: String(body.name).trim(),
    address: String(body.address).trim(),
    phone: String(body.phone).trim(),
    email: String(body.email).trim(),
    zip: body.zip ?? null,
    propertyType,
    contactPreference,
    styleKey: body.styleKey ?? null,
    styleLabel: body.styleLabel ?? null,
    customized: Boolean(body.customized),
    packageKey: body.packageKey ?? null,
    packageLabel: body.packageLabel ?? null,
    packageFeatures: Array.isArray(body.packageFeatures) ? body.packageFeatures : null,
    offerPresented: propertyType === "residential" ? CURRENT_OFFER : null,
    originalPhoto,
    renderedPhoto,
  };

  fs.writeFileSync(path.join(leadDir, "lead.json"), JSON.stringify(record, null, 2));

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO leads (
           id, submitted_at, name, address, phone, email, zip, property_type,
           style_key, style_label, customized, package_key, package_label,
           package_features, offer_presented, original_image, rendered_image, contact_preference
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          record.id,
          record.submittedAt,
          record.name,
          record.address,
          record.phone,
          record.email,
          record.zip,
          record.propertyType,
          record.styleKey,
          record.styleLabel,
          record.customized,
          record.packageKey,
          record.packageLabel,
          record.packageFeatures ? JSON.stringify(record.packageFeatures) : null,
          record.offerPresented,
          body.originalImage ?? null,
          body.renderedImage ?? null,
          record.contactPreference,
        ]
      );
    } catch (err) {
      console.error("Failed to persist lead to database:", err);
    }
  }

  res.json({ ok: true, leadId });

  // PDF generation + office notification email + CRM sync all run after the response is
  // sent so the customer isn't kept waiting on them; failures here are logged, never
  // surfaced to the customer or allowed to affect the lead having already been saved above.
  generateLeadPdf({
    ...record,
    originalImageDataUrl: body.originalImage,
    renderedImageDataUrl: body.renderedImage,
  })
    .then((pdfBuffer) => {
      fs.writeFileSync(path.join(leadDir, "lead-summary.pdf"), pdfBuffer);
      return sendLeadEmail({ lead: record, pdfBuffer });
    })
    .catch((err) => console.error("Failed to generate/send lead PDF for", leadId, ":", err));

  syncLeadToCrm(record).catch((err) => console.error("Failed to sync lead to CRM for", leadId, ":", err));

  sendCustomerConfirmationEmail({ lead: record }).catch((err) =>
    console.error("Failed to send customer confirmation email for", leadId, ":", err)
  );
});

app.post("/api/generate-all", generationGuard, upload.single("image"), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it to .env and restart." });
  }
  if (!isZipInServiceArea(req.body?.zip)) {
    return res.status(403).json({ error: "This ZIP code is outside Blue Duck's service area." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded." });
  }

  // Reject non-photos before spending any paid AI calls on them (and without using up the visitor's
  // allowance — an attempt only counts once we actually start generating).
  const { buffer, mimetype } = req.file;
  if (!/^image\//.test(mimetype)) {
    return res.status(400).json({ error: "Please upload a photo (JPG or PNG) of your home." });
  }
  const sharp = await sharpPromise;
  if (sharp) {
    try {
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200 || meta.width * meta.height > 100e6) {
        return res
          .status(400)
          .json({ error: "That photo is too small or too large to use. Please upload a regular photo of your home." });
      }
    } catch {
      return res.status(400).json({ error: "We couldn't read that file. Please upload a JPG or PNG photo of your home." });
    }
  }

  req.abuse.commit();

  const settled = await Promise.allSettled(
    STYLES.map((style, i) =>
      new Promise((r) => setTimeout(r, i * 400)).then(() => generateStyledImage(buffer, mimetype, style.description))
    )
  );

  const results = STYLES.map((style, i) => {
    const outcome = settled[i];
    return outcome.status === "fulfilled"
      ? { key: style.key, label: style.label, image: outcome.value }
      : { key: style.key, label: style.label, error: outcome.reason?.message ?? "Failed to generate this style." };
  });

  // If every style failed (e.g. an upstream outage), that's on us — don't charge the visitor's allowance.
  if (results.every((r) => r.error)) req.abuse.refund();

  res.json({ results, previewsRemaining: req.abuse.remaining() });
});

// Keep errors from body parsing / uploads as clean JSON the front end can show.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const tooBig = err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE";
  const status = tooBig ? 413 : err?.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error("Unhandled error:", err);
  res.status(status).json({
    error: tooBig
      ? "That file is too large. Please upload a smaller photo."
      : status === 500
        ? "Something went wrong on our end. Please try again."
        : "We couldn't process that request.",
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Christmas Light Designer running at http://localhost:${port}`);
});
