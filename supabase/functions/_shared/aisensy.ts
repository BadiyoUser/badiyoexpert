// Sends a WhatsApp template message via AiSensy.
// AiSensy often returns HTTP 200 even on failure, embedding the error in the
// response body — we parse and inspect it so silent failures surface.
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

  console.log("[AiSensy] sending", {
    campaign: payload.campaignName,
    destination: dest,
    paramCount: payload.templateParams.length,
  });

  let res: Response;
  try {
    res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[AiSensy] network error", e);
    throw new Error(`AiSensy network error: ${(e as Error).message}`);
  }

  const text = await res.text();
  console.log("[AiSensy] response", res.status, text);

  if (!res.ok) {
    throw new Error(`AiSensy send failed (${res.status}): ${text}`);
  }

  // AiSensy sometimes returns 200 with {"success":false,...} or {"status":"error",...}
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body — assume success if 200
  }
  if (parsed) {
    const success = parsed["success"];
    const status = String(parsed["status"] ?? "").toLowerCase();
    if (success === false || status === "error" || status === "failed") {
      const msg = parsed["message"] ?? parsed["error"] ?? text;
      throw new Error(`AiSensy send failed: ${msg}`);
    }
  }
  return text;
}
