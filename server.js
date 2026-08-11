import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";

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
}
ensureLeadsTable().catch((err) => console.error("Failed to ensure leads table exists:", err));

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
  { key: "warm_white", label: "Warm White", description: "warm white (soft yellowish) large C9 bulbs" },
  {
    key: "multicolor",
    label: "Multicolored",
    description:
      "large C9 bulbs in a strict repeating four-bulb sequence: one red bulb, then one green bulb, then one " +
      "blue bulb, then one gold/yellow bulb, continuously repeating in that exact order along the entire " +
      "strand. All four colors must be clearly, vividly visible in equal proportion — do not let red or any " +
      "single color dominate, and do not let any color fade out, blend together, or go missing",
  },
  {
    key: "red_white",
    label: "Red and White",
    description:
      "large C9 bulbs in a strict repeating White, Red, White, Red pattern — " +
      "both colors must be clearly and equally visible along every strand, not just red",
  },
  {
    key: "red_green_white",
    label: "Red, Green and White",
    description:
      "large C9 bulbs in a strict repeating three-bulb sequence: one red bulb, then one green bulb, then " +
      "one white bulb, continuously repeating. Exactly one-third of all bulbs must be red, one-third must be " +
      "green, and one-third must be white. The green bulbs are the most important to get right — they must be " +
      "clearly, vividly visible throughout every strand, not sparse, not faint, and not outnumbered by the red " +
      "or white bulbs",
  },
];

app.use(cors());
app.use(express.static("public"));

function buildPrompt(lightDescription) {
  return (
    `Edit this photo of a house to add ${lightDescription} for Christmas, installed exactly the way a ` +
    "professional residential Christmas light company installs a standard roofline (C9 gutter-line) package. " +
    "ONLY add lights along the gutter line / eave edge of the roof — the lower edge where the fascia and " +
    "gutter are mounted, which is the only edge a lighting crew can physically clip C9 bulbs to from a ladder. " +
    "Cover the ENTIRE gutter line of the house — every gable, every roof section, and the full length of every " +
    "eave visible in the photo. Do not light only one section (such as just the porch roof) while leaving other " +
    "visible roof sections dark; a real installation crew lights the whole house, not one section of it. " +
    "This includes both flat horizontal runs of gutter AND sloped/raked sections that follow a gable edge " +
    "diagonally up toward its peak — both count as legitimate gutter line as long as they are the LOWER roof " +
    "edge (where roof meets wall or fascia), not the upper edge. " +
    "Do NOT put lights on the ridge line or hip line — the horizontal or angled line at the very TOP of the " +
    "roof where two roof slopes meet. There is no gutter up there, so it is never a realistic install point. " +
    "Every single bulb must sit on a real, continuous gutter/eave edge that is clearly visible in the photo. " +
    "If you are not certain an edge is the gutter line, leave it unlit. " +
    "\n\nDo NOT add lights anywhere else. This is a strict list of what to leave completely unlit:\n" +
    "- Do NOT outline windows or window frames.\n" +
    "- Do NOT run lights down gutter downspouts or any vertical drainpipe.\n" +
    "- Do NOT outline the front door or any door frame.\n" +
    "- Do NOT run lights vertically down columns, posts, or porch supports.\n" +
    "- Do NOT add lights to trees.\n" +
    "- Do NOT add lights to bushes, hedges, or other landscaping.\n" +
    "- Do NOT add lights along the sidewalk, driveway, walkway, or as ground stakes.\n" +
    "- Do NOT add any lights that are not directly on the roofline.\n\n" +
    "\n\nBulb size and spacing are critical — this must read as real, individually-installed C9 bulbs, not a " +
    "glowing LED strip or rope light:\n" +
    "- Render each bulb as a large, distinct, individually-shaped C9 bulb (the classic large oval Christmas " +
    "bulb, not a small mini-light).\n" +
    "- Space the bulbs at consistent intervals of approximately 12 to 15 inches apart, scaled proportionally " +
    "to the real-world size of the house in the photo.\n" +
    "- Each bulb must remain visually separate from its neighbors — there must be clearly visible dark gutter " +
    "line between adjacent bulbs. Do NOT render a continuous glowing line, blurred strip, or rope light where " +
    "individual bulbs are not distinguishable.\n" +
    "- When colors alternate, each bulb must be a single, crisp, visually distinct color — for example a clean " +
    "white bulb directly next to a clean red bulb — never a blended or gradient color between two bulbs.\n\n" +
    "Give each bulb a realistic warm glow and subtle light bloom, as if photographed at dusk or early evening, " +
    "but keep the glow subtle enough that the individual bulb shapes, spacing, and colors described above " +
    "remain clearly visible. " +
    "Keep the house structure, landscaping, background, and camera angle exactly the same — only add the " +
    "roofline lights themselves and a natural dusk-toned sky if the original photo was taken in daylight. " +
    "Do not add snow, decorations other than the roofline lights, or text of any kind. " +
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

  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
}

app.use(express.json({ limit: "30mb" }));

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
  const requiredFields = ["name", "address", "phone", "email"];
  const missing = requiredFields.filter((f) => !String(body[f] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const leadId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const leadDir = path.join(LEADS_DIR, leadId);
  fs.mkdirSync(leadDir, { recursive: true });

  const originalPhoto = saveDataUrlImage(body.originalImage, path.join(leadDir, "original"));
  const renderedPhoto = saveDataUrlImage(body.renderedImage, path.join(leadDir, "rendered"));

  const propertyType = body.propertyType === "commercial" ? "commercial" : "residential";

  const record = {
    id: leadId,
    submittedAt: new Date().toISOString(),
    name: String(body.name).trim(),
    address: String(body.address).trim(),
    phone: String(body.phone).trim(),
    email: String(body.email).trim(),
    zip: body.zip ?? null,
    propertyType,
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
           package_features, offer_presented, original_image, rendered_image
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
        ]
      );
    } catch (err) {
      console.error("Failed to persist lead to database:", err);
    }
  }

  res.json({ ok: true, leadId });
});

app.post("/api/generate-all", upload.single("image"), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it to .env and restart." });
  }
  if (!isZipInServiceArea(req.body?.zip)) {
    return res.status(403).json({ error: "This ZIP code is outside Blue Duck's service area." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded." });
  }

  const { buffer, mimetype } = req.file;

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

  res.json({ results });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Christmas Light Designer running at http://localhost:${port}`);
});
