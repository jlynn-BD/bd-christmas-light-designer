import { Resend } from "resend";

const OFFICE_EMAIL = "hello@trustblueduck.com";
const FROM_EMAIL = process.env.LEAD_EMAIL_FROM || "christmaslead@resend.dev";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CONTACT_PREFERENCE_COPY = {
  call: "A member of our design team will reach out by phone shortly to walk you through your options.",
  quote_only: "You'll receive your personalized estimate by email shortly — no call needed.",
};

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

/**
 * Emails the customer themselves a confirmation that their request was received,
 * mirroring the on-screen thank-you page. Never throws — logs and returns
 * { ok: false } on failure so a lead submission never fails because of this.
 *
 * Deliberately plain HTML with no attachments or inline images — matches the
 * structure of the office notification email, which reliably lands in the
 * inbox rather than spam on this freshly-verified sending domain.
 */
export async function sendCustomerConfirmationEmail({ lead }) {
  if (!resend) {
    console.error("RESEND_API_KEY is not set — skipping customer confirmation email.");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const isCommercial = lead.propertyType === "commercial";
  const firstName = String(lead.name ?? "").trim().split(/\s+/)[0] || "there";

  const subject = isCommercial
    ? "Your Blue Duck consultation request has been received!"
    : "Your Blue Duck Christmas Lights request has been received!";

  const nextStep = isCommercial
    ? "A member of the Blue Duck Christmas Lights team will contact you shortly to schedule your consultation."
    : CONTACT_PREFERENCE_COPY[lead.contactPreference] ??
      "You'll receive your personalized estimate by email, or a member of our design team will contact you shortly.";

  const offerBanner =
    !isCommercial && lead.offerPresented
      ? `
      <div style="background: linear-gradient(135deg, #e63946, #b3212c); border-radius: 10px; padding: 18px 20px; margin: 18px 0; text-align: center;">
        <span style="display: inline-block; background: #f5c842; color: #16305c; font-weight: bold; font-size: 12px; padding: 4px 12px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 8px;">🎉 Offer Locked In</span>
        <p style="margin: 8px 0 0; color: #fff; font-size: 15px;">You've claimed <strong>50% off your first year</strong> of professional installation and takedown.</p>
      </div>`
      : "";

  const designSummary =
    !isCommercial && lead.styleLabel
      ? `<p style="color: #5a6b85; margin: 0 0 4px;">You chose <strong style="color:#1a1a1a;">${escapeHtml(lead.styleLabel)}</strong>${
          lead.packageLabel ? ` — <strong style="color:#1a1a1a;">${escapeHtml(lead.packageLabel)}</strong>` : ""
        }.</p>`
      : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a; text-align: center;">
      <h2 style="color: #16305c; margin-bottom: 4px;">Your Request Has Been Received!</h2>
      <p style="color: #5a6b85; font-size: 15px;">Hi ${escapeHtml(firstName)}, thanks for using our design tool.</p>
      <p style="color: #1a1a1a; font-size: 15px; line-height: 1.5;">${escapeHtml(nextStep)}</p>
      ${offerBanner}
      ${designSummary}
      <p style="color: #5a6b85; font-size: 13px; margin-top: 24px;">— The Blue Duck Christmas Lights Team</p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Blue Duck Christmas Lights <${FROM_EMAIL}>`,
      to: lead.email,
      subject,
      html,
    });

    if (result.error) {
      console.error("Resend API returned an error sending customer confirmation email:", result.error);
      return { ok: false, error: result.error };
    }

    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error("Failed to send customer confirmation email:", err);
    return { ok: false, error: err.message };
  }
}

const CONCEPT_BCC = process.env.TEAM_EMAIL_BCC === undefined ? OFFICE_EMAIL : process.env.TEAM_EMAIL_BCC;

/**
 * Emails a customer the presentation PDF a sales rep built in the Design Studio. The office is
 * BCC'd (set TEAM_EMAIL_BCC to another address, or "none" to disable) and replies go to the rep's
 * own email when they gave one. Never throws.
 */
export async function sendConceptEmail({ to, customerName, repName, repEmail, pdfBuffer, styleLabel, packageName, offer }) {
  if (!resend) return { ok: false, error: "RESEND_API_KEY not configured" };

  const first = String(customerName ?? "").trim().split(/\s+/)[0] || "there";
  const signer = repName ? `${escapeHtml(repName)} at Blue Duck Christmas Lights` : "The Blue Duck Christmas Lights Team";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #16305c; margin-bottom: 4px;">Your custom holiday lighting concept</h2>
      <p style="font-size: 15px; line-height: 1.5;">Hi ${escapeHtml(first)},</p>
      <p style="font-size: 15px; line-height: 1.5;">Thanks for your time! ${repName ? escapeHtml(repName) + " put" : "We put"} together a lighting concept for your home — it's attached as a PDF.</p>
      <p style="color: #5a6b85; font-size: 14px; margin: 0 0 4px;">Design: <strong style="color:#1a1a1a;">${escapeHtml(styleLabel)}</strong></p>
      ${packageName ? `<p style="color: #5a6b85; font-size: 14px; margin: 0 0 4px;">Package: <strong style="color:#1a1a1a;">${escapeHtml(packageName)}</strong></p>` : ""}
      ${offer ? `<p style="color: #b3212c; font-size: 14px; font-weight: bold; margin: 8px 0;">${escapeHtml(offer)}</p>` : ""}
      <p style="font-size: 15px; line-height: 1.5;">Just reply to this email with any questions or when you're ready to move forward.</p>
      <p style="color: #5a6b85; font-size: 13px; margin-top: 24px;">— ${signer}</p>
      <p style="color: #8a97ad; font-size: 11px; margin-top: 18px;">The preview is AI-generated for visualization only; actual installation may vary.</p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Blue Duck Christmas Lights <${FROM_EMAIL}>`,
      to,
      ...(CONCEPT_BCC && CONCEPT_BCC.toLowerCase() !== "none" ? { bcc: CONCEPT_BCC } : {}),
      ...(repEmail ? { replyTo: repEmail } : {}),
      subject: "Your custom holiday lighting concept from Blue Duck",
      html,
      attachments: [{ filename: "Blue-Duck-Holiday-Lighting-Concept.pdf", content: pdfBuffer.toString("base64") }],
    });
    if (result.error) {
      console.error("Resend API returned an error sending concept email:", result.error);
      return { ok: false, error: result.error };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error("Failed to send concept email:", err);
    return { ok: false, error: err.message };
  }
}
