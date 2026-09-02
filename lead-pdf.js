import PDFDocument from "pdfkit";
import path from "path";

const LOGO_PATH = path.join(process.cwd(), "public", "blue-duck-logo.png");

const BRAND_NAVY = "#16305c";
const BRAND_GOLD = "#c9962b";
const BRAND_MUTED = "#5a6b85";
const BRAND_TEXT = "#1a1a1a";

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

function sectionHeading(doc, text) {
  doc.moveDown(0.8);
  doc.fillColor(BRAND_NAVY).font("Helvetica-Bold").fontSize(13).text(text);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor(BRAND_GOLD).lineWidth(1.5).stroke();
  doc.moveDown(0.6);
}

function field(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND_MUTED).text(label, { continued: true });
  doc.font("Helvetica").fontSize(10).fillColor(BRAND_TEXT).text(`  ${value || "—"}`);
}

/**
 * Build a single-document PDF summarizing a submitted lead: customer info,
 * chosen design (with the original + AI-rendered photos), and chosen package.
 * Returns a Buffer.
 */
export function generateLeadPdf(lead) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    const headerTop = doc.y;
    const logoHeight = 50;
    try {
      doc.image(LOGO_PATH, doc.page.margins.left, headerTop, { height: logoHeight });
    } catch {
      // logo missing — continue without it
    }

    const textX = doc.page.margins.left + 95;
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(BRAND_NAVY)
      .text("New Lead Summary", textX, headerTop + 2, { lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND_MUTED)
      .text(`Submitted ${new Date(lead.submittedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`, textX, headerTop + 27, {
        lineBreak: false,
      });
    doc.text(`Lead ID: ${lead.id}`, textX, headerTop + 40, { lineBreak: false });

    doc.y = headerTop + logoHeight + 14;
    doc.x = doc.page.margins.left;

    // Contact-preference banner — the operational routing signal staff need first
    if (lead.contactPreference === "call" || lead.contactPreference === "quote_only") {
      const isCall = lead.contactPreference === "call";
      const bannerColor = isCall ? "#b3212c" : "#2f7d32";
      const bannerText = isCall
        ? "CALL CUSTOMER — wants to talk with a designer"
        : "QUOTE ONLY — customer just wants a price emailed, no call needed";

      const bannerX = doc.page.margins.left;
      const bannerWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bannerY = doc.y;
      const bannerHeight = 26;

      doc.rect(bannerX, bannerY, bannerWidth, bannerHeight).fill(bannerColor);
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#ffffff")
        .text(bannerText, bannerX + 10, bannerY + 7, { width: bannerWidth - 20 });

      doc.y = bannerY + bannerHeight + 14;
      doc.x = doc.page.margins.left;
    }

    // Customer information
    sectionHeading(doc, "Customer Information");
    field(doc, "Name:", lead.name);
    field(doc, "Property Address:", lead.address);
    field(doc, "Phone:", lead.phone);
    field(doc, "Email:", lead.email);
    field(doc, "Property Type:", lead.propertyType === "commercial" ? "Commercial" : "Residential");
    if (lead.zip) field(doc, "ZIP:", lead.zip);

    if (lead.propertyType === "commercial") {
      sectionHeading(doc, "Request Type");
      doc.font("Helvetica").fontSize(10).fillColor(BRAND_TEXT).text(
        "Commercial consultation request — no AI design preview is generated for commercial properties. " +
          "A site visit is required before a custom design and quote can be provided."
      );
      doc.end();
      return;
    }

    // Design information
    sectionHeading(doc, "Design Information");
    field(doc, "Selected Design:", lead.styleLabel + (lead.customized ? " (customized by customer)" : ""));

    doc.moveDown(0.4);
    const imgWidth = 240;
    const imgY = doc.y;
    const leftX = doc.page.margins.left;
    const rightX = doc.page.width / 2 + 10;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND_MUTED).text("Customer's House Photo", leftX, imgY, { width: imgWidth });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND_MUTED).text("AI-Generated Preview", rightX, imgY, { width: imgWidth });

    const captionBottom = doc.y;
    const originalBuf = dataUrlToBuffer(lead.originalImageDataUrl);
    const renderedBuf = dataUrlToBuffer(lead.renderedImageDataUrl);

    let imageBottom = captionBottom;
    try {
      if (originalBuf) {
        doc.image(originalBuf, leftX, captionBottom + 4, { width: imgWidth, height: 180, fit: [imgWidth, 180] });
        imageBottom = Math.max(imageBottom, captionBottom + 4 + 180);
      }
      if (renderedBuf) {
        doc.image(renderedBuf, rightX, captionBottom + 4, { width: imgWidth, height: 180, fit: [imgWidth, 180] });
        imageBottom = Math.max(imageBottom, captionBottom + 4 + 180);
      }
    } catch {
      // if an image fails to decode/embed, continue without blocking the rest of the PDF
    }

    doc.y = imageBottom + 10;
    doc.x = doc.page.margins.left;

    // Package information
    sectionHeading(doc, "Package Information");
    if (lead.packageLabel) {
      field(doc, "Selected Package:", lead.packageLabel);
      doc.moveDown(0.3);
      const features = Array.isArray(lead.packageFeatures) && lead.packageFeatures.length ? lead.packageFeatures : ["Roofline"];
      doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND_MUTED).text("Included Components:");
      doc.moveDown(0.15);
      for (const feature of features) {
        doc.font("Helvetica").fontSize(10).fillColor(BRAND_TEXT).text(`•  ${feature}`, { indent: 10 });
      }
    } else {
      doc.font("Helvetica").fontSize(10).fillColor(BRAND_TEXT).text("No package was selected.");
    }

    if (lead.offerPresented) {
      sectionHeading(doc, "Offer Presented to Customer");
      doc.font("Helvetica").fontSize(10).fillColor(BRAND_TEXT).text(lead.offerPresented);
    }

    doc.end();
  });
}
