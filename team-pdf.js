import PDFDocument from "pdfkit";
import path from "path";

const LOGO_PATH = path.join(process.cwd(), "public", "blue-duck-logo.png");

const NAVY = "#16305c";
const GOLD = "#c9962b";
const MUTED = "#5a6b85";
const TEXT = "#1a1a1a";
const RED = "#b3212c";

const DISCLAIMER =
  "AI-generated preview for visualization purposes only. Actual installation may vary. Blue Duck does not " +
  "typically install lighting around windows or down downspouts, even if these elements appear in the generated preview.";

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl ?? "");
  return match ? Buffer.from(match[1], "base64") : null;
}

function heading(doc, text) {
  doc.moveDown(0.7);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(text, doc.page.margins.left);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor(GOLD).lineWidth(1.5).stroke();
  doc.moveDown(0.5);
}

/**
 * Customer-facing "concept presentation" a Blue Duck sales rep can hand or email to a homeowner:
 * their house with the chosen lighting design, the package, and (optionally) the current offer.
 * Unlike the internal lead summary, this is written for the customer to read.
 * Returns a Buffer.
 */
export function generatePresentationPdf({ customerName, address, repName, styleLabel, packageName, packageFeatures, offer, notes, originalImage, renderedImage }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40, info: { Title: "Your Custom Holiday Lighting Concept", Author: "Blue Duck Christmas Lights" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - left - doc.page.margins.right;

    // ----- header
    const top = doc.y;
    try {
      doc.image(LOGO_PATH, left, top, { height: 54 });
    } catch {
      /* logo missing — carry on */
    }
    const textX = left + 100;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text("Your Custom Holiday Lighting Concept", textX, top + 2, { width: contentWidth - 100, lineBreak: false });
    const prepared = [customerName && `Prepared for ${customerName}`, address].filter(Boolean).join("  •  ");
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    if (prepared) doc.text(prepared, textX, top + 28, { width: contentWidth - 100, lineBreak: false });
    const byline = [repName && `Designed by ${repName}`, new Date().toLocaleDateString("en-US", { dateStyle: "long" })].filter(Boolean).join("  •  ");
    doc.text(byline, textX, top + 42, { width: contentWidth - 100, lineBreak: false });
    doc.y = top + 70;
    doc.x = left;

    // ----- the hero: their home with the lights on
    const renderedBuf = dataUrlToBuffer(renderedImage);
    const originalBuf = dataUrlToBuffer(originalImage);

    doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(`Your home with Blue Duck lights — ${styleLabel}`, left, doc.y);
    doc.moveDown(0.3);
    const heroTop = doc.y;
    const heroH = 245;
    try {
      if (renderedBuf) doc.image(renderedBuf, left, heroTop, { fit: [contentWidth, heroH], align: "center", valign: "top" });
    } catch {
      /* skip an undecodable image rather than failing the whole PDF */
    }
    doc.y = heroTop + heroH + 8;
    doc.x = left;

    // ----- before photo + design details side by side
    const rowTop = doc.y;
    const thumbW = 190;
    const thumbH = 120;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("Your home today", left, rowTop);
    try {
      if (originalBuf) doc.image(originalBuf, left, rowTop + 14, { fit: [thumbW, thumbH], valign: "top" });
    } catch {
      /* skip */
    }

    const detailX = left + thumbW + 24;
    const detailW = contentWidth - thumbW - 24;
    let y = rowTop;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("Lighting design", detailX, y, { width: detailW });
    doc.font("Helvetica").fontSize(10).fillColor(TEXT).text(styleLabel, detailX, doc.y + 2, { width: detailW });

    if (packageName) {
      doc.moveDown(0.7);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("Package", detailX, doc.y, { width: detailW });
      doc.font("Helvetica").fontSize(10).fillColor(TEXT).text(packageName, detailX, doc.y + 2, { width: detailW });
      doc.moveDown(0.3);
      for (const f of packageFeatures?.length ? packageFeatures : ["Roofline"]) {
        doc.font("Helvetica").fontSize(10).fillColor(TEXT).text(`•  ${f}`, detailX + 6, doc.y, { width: detailW - 6 });
      }
    }

    doc.y = Math.max(doc.y, rowTop + 14 + thumbH) + 6;
    doc.x = left;

    // ----- offer
    if (offer) {
      heading(doc, "Your Offer");
      doc.font("Helvetica-Bold").fontSize(12).fillColor(RED).text(offer, left, doc.y, { width: contentWidth });
    }

    // ----- rep's notes
    if (notes) {
      heading(doc, "Notes");
      doc.font("Helvetica").fontSize(10).fillColor(TEXT).text(notes, left, doc.y, { width: contentWidth });
    }

    // ----- next step + disclaimer, pinned to the bottom of the page
    const footerY = doc.page.height - doc.page.margins.bottom - 62;
    if (doc.y > footerY - 28) doc.addPage(); // content ran long — keep the footer from overprinting it
    doc.font("Helvetica").fontSize(10).fillColor(NAVY).text("Ready to bring this to life? Reply to the email this came with, or contact us at hello@trustblueduck.com.", left, footerY - 18, { width: contentWidth });
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED).text(DISCLAIMER, left, footerY + 8, { width: contentWidth, height: 40 });

    doc.end();
  });
}
