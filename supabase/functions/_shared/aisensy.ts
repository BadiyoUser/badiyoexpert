// Sends a WhatsApp template message via AiSensy.
// See https://apps.aisensy.com/ for template setup.
export async function sendAiSensyTemplate(opts: {
  campaignName: string;
  destination: string; // e.g. "918698340766" (no +)
  userName?: string;
  templateParams?: string[];
}) {
  const apiKey = Deno.env.get("AISENSY_API_KEY");
  if (!apiKey) throw new Error("AISENSY_API_KEY not configured");

  const dest = opts.destination.replace(/[^\d]/g, "");
  const payload = {
    apiKey,
    campaignName: opts.campaignName,
    destination: dest,
    userName: opts.userName ?? "Badiyo Expert",
    templateParams: opts.templateParams ?? [],
  };

  const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("AiSensy error", res.status, text);
    throw new Error(`AiSensy send failed: ${res.status}`);
  }
  return text;
}
