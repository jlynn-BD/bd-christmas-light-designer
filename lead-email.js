import { Resend } from "resend";

const OFFICE_EMAIL = "hello@trustblueduck.com";
const FROM_EMAIL = process.env.LEAD_EMAIL_FROM || "christmaslead@resend.dev";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Emails the office a quick-glance summary plus the full lead PDF attached.
 * Never throws — logs and returns { ok: false } on failure so a lead
 * submission never fails just because the notification email didn't send.
 */
export async function sendLeadEmail({ lead, pdfBuffer }) {
  if (!resend) {
    console.error("RESEND_API_KEY is not set — skipping lead notification email.");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const isCommercial = lead.propertyType === "commercial";
  const isCallPref = lead.contactPreference === "call";
  const isQuoteOnlyPref = lead.contactPreference === "quote_only";

  const subjectPrefix = isCallPref ? "[CALL] " : isQuoteOnlyPref ? "[QUOTE ONLY] " : "";
  const subject = isCommercial
    ? `New commercial consultation request — ${lead.name}`
    : `${subjectPrefix}New lead: ${lead.name} — ${lead.styleLabel ?? "design"}${lead.packageLabel ? ` / ${lead.packageLabel}` : ""}`;

  const preferenceBanner =
    !isCommercial && (isCallPref || isQuoteOnlyPref)
      ? `
      <div style="background: ${isCallPref ? "#b3212c" : "#2f7d32"}; color: #fff; font-weight: bold; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px;">
        ${isCallPref ? "📞 CALL CUSTOMER — wants to talk with a designer" : "📧 QUOTE ONLY — customer just wants a price emailed, no call needed"}
      </div>`
      : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #16305c; margin-bottom: 4px;">New ${isCommercial ? "Commercial Consultation Request" : "Lead"}</h2>
      <p style="color: #5a6b85; margin-top: 0;">Full details, house photo, and AI preview are in the attached PDF.</p>
      ${preferenceBanner}
      <table cellpadding="6" style="border-collapse: collapse; width: 100%;">
        <tr><td style="color:#5a6b85; font-weight:bold;">Name</td><td>${escapeHtml(lead.name)}</td></tr>
        <tr><td style="color:#5a6b85; font-weight:bold;">Address</td><td>${escapeHtml(lead.address)}</td></tr>
        <tr><td style="color:#5a6b85; font-weight:bold;">Phone</td><td>${escapeHtml(lead.phone)}</td></tr>
        <tr><td style="color:#5a6b85; font-weight:bold;">Email</td><td>${escapeHtml(lead.email)}</td></tr>
        ${
          !isCommercial
            ? `
        <tr><td style="color:#5a6b85; font-weight:bold;">Design</td><td>${escapeHtml(lead.styleLabel)}${lead.customized ? " (customized)" : ""}</td></tr>
        <tr><td style="color:#5a6b85; font-weight:bold;">Package</td><td>${escapeHtml(lead.packageLabel || "—")}</td></tr>
        `
            : ""
        }
      </table>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Blue Duck Christmas Lights <${FROM_EMAIL}>`,
      to: OFFICE_EMAIL,
      subject,
      html,
      attachments: [
        {
          filename: `lead-${lead.id}.pdf`,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (result.error) {
      console.error("Resend API returned an error sending lead email:", result.error);
      return { ok: false, error: result.error };
    }

    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error("Failed to send lead notification email:", err);
    return { ok: false, error: err.message };
  }
}
