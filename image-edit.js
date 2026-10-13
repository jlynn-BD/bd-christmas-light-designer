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
