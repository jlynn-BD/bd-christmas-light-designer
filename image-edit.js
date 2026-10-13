/**
 * Sorts a Gemini API error into what's actually wrong, so the app can react properly:
 *   billing   - prepaid credits are used up (HTTP 402) — design generation is down until topped up
 *   auth      - the API key was rejected or lacks permission
 *   model     - Google retired or renamed the model we call
 *   transient - busy / rate-limited / temporarily unavailable — worth retrying
 *   other     - anything else (e.g. the model replied with text instead of an image)
 */
export function classifyAiError(err) {
  const m = String(err?.message ?? err ?? "");
  if (/\b402\b|prepayment credits|credits are depleted/i.test(m)) return "billing";
  if (/\b401\b|\b403\b|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(m)) return "auth";
  if (/\b404\b|no longer available|NOT_FOUND/i.test(m)) return "model";
  if (/\b429\b|\b503\b|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(m)) return "transient";
  return "other";
}

/** Service-level problems a visitor can't fix and the owner needs to hear about. */
export const SERVICE_DOWN_KINDS = ["billing", "auth", "model"];

function tag(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  e.kind = classifyAiError(e);
  return e;
}

/**
 * Sends a photo plus an editing instruction to the Gemini image model and returns the edited picture
 * as a JPEG data URL. Retries transient API errors and empty replies.
 */
export async function editImageWithPrompt({ ai, sharpPromise, fileBuffer, mimeType, prompt }) {
  const contents = [
    { text: prompt },
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
      // Only genuinely temporary errors are worth retrying. (Google's "out of credits" reply also contains
      // the words RESOURCE_EXHAUSTED, so classify properly instead of matching on that alone.)
      if (classifyAiError(err) !== "transient" || attempt === MAX_ATTEMPTS) throw tag(err);
    }

    if (!imagePart && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  if (!imagePart) {
    throw tag(new Error(lastTextReply ? `Model returned no image: ${lastTextReply}` : "Model returned no image."));
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
