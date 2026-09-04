const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: GHL_API_VERSION,
    "Content-Type": "application/json",
  };
}

function splitName(fullName) {
  const parts = String(fullName ?? "").trim().split(/\s+/);
  const firstName = parts.shift() ?? "";
  const lastName = parts.join(" ");
  return { firstName, lastName };
}

function buildNoteBody(lead) {
  const isCommercial = lead.propertyType === "commercial";
  const lines = [];

  if (!isCommercial) {
    if (lead.contactPreference === "call") {
      lines.push("CALL CUSTOMER — wants to talk with a designer");
    } else if (lead.contactPreference === "quote_only") {
      lines.push("QUOTE ONLY — customer just wants a price emailed, no call needed");
    }
    lines.push("");
    lines.push(`Design: ${lead.styleLabel ?? "—"}${lead.customized ? " (customized by customer)" : ""}`);
    lines.push(`Package: ${lead.packageLabel ?? "—"}`);
    if (Array.isArray(lead.packageFeatures) && lead.packageFeatures.length) {
      lines.push(`Components: ${lead.packageFeatures.join(", ")}`);
    }
    if (lead.offerPresented) lines.push(`Offer presented: ${lead.offerPresented}`);
  } else {
    lines.push("Commercial consultation request — no AI design preview generated.");
  }

  lines.push("");
  lines.push(`Property type: ${isCommercial ? "Commercial" : "Residential"}`);
  if (lead.zip) lines.push(`ZIP: ${lead.zip}`);
  lines.push(`Lead ID: ${lead.id}`);
  lines.push("Full house photo, AI preview, and a printable summary were emailed to the office as a PDF.");

  return lines.join("\n");
}

/**
 * Creates (or updates, if a matching contact already exists) a GoHighLevel
 * contact for a submitted lead, with a note summarizing their design/package
 * choices. Never throws — logs and returns { ok: false } on failure so a lead
 * submission never fails just because the CRM sync didn't work.
 */
export async function syncLeadToCrm(lead) {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) {
    console.error("GHL_API_KEY / GHL_LOCATION_ID not set — skipping GoHighLevel sync.");
    return { ok: false, error: "GoHighLevel not configured" };
  }

  const { firstName, lastName } = splitName(lead.name);
  const isCommercial = lead.propertyType === "commercial";

  const tags = ["AI Design Lead", isCommercial ? "Commercial" : "Residential"];
  if (lead.contactPreference === "call") tags.push("Wants Call");
  if (lead.contactPreference === "quote_only") tags.push("Quote Only");

  try {
    const contactRes = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        address1: lead.address,
        tags,
        source: "Christmas Light Designer Widget",
      }),
    });

    const contactData = await contactRes.json();
    if (!contactRes.ok) {
      console.error("GoHighLevel contact upsert failed:", contactRes.status, contactData);
      return { ok: false, error: contactData };
    }

    const contactId = contactData.contact?.id ?? contactData.id;
    if (!contactId) {
      console.error("GoHighLevel upsert response had no contact id:", contactData);
      return { ok: false, error: "No contact id returned" };
    }

    const noteRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({ body: buildNoteBody(lead) }),
    });

    if (!noteRes.ok) {
      const noteError = await noteRes.json().catch(() => null);
      console.error("GoHighLevel note creation failed:", noteRes.status, noteError);
      return { ok: false, error: noteError, contactId };
    }

    return { ok: true, contactId };
  } catch (err) {
    console.error("Failed to sync lead to GoHighLevel:", err);
    return { ok: false, error: err.message };
  }
}
