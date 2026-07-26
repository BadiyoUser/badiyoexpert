import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendAiSensyTemplate } from "../_shared/aisensy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOS_CAMPAIGN = Deno.env.get("AISENSY_SOS_CAMPAIGN") ?? "badiyososalerts";
const SUPPORT_PHONE = Deno.env.get("BADIYO_SUPPORT_PHONE") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, { status: 401 });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, { status: 401 });
    const authUserId = userData.user.id;

    const { data: expert } = await admin
      .from("experts")
      .select("id, name, phone, current_lat, current_lng, location_updated_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!expert) return json({ error: "Expert profile not found" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as {
      booking_id?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      notes?: string | null;
    };

    const { data: alert, error: insErr } = await admin
      .from("emergency_alerts")
      .insert({
        expert_id: expert.id,
        booking_id: body.booking_id ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
        status: "new",
      })
      .select("id, created_at")
      .single();
    if (insErr) throw insErr;

    // Fire-and-report WhatsApp alert to support.
    if (SUPPORT_PHONE) {
      const timeStr = new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true,
      });
      const mapsLink = body.latitude && body.longitude
        ? `https://maps.google.com/?q=${body.latitude},${body.longitude}`
        : "Location unavailable";
      console.log("[SOS] dispatching WhatsApp", {
        campaign: SOS_CAMPAIGN,
        support: SUPPORT_PHONE,
        params: [expert.name, expert.phone, body.booking_id ?? "N/A", timeStr, mapsLink],
      });
      try {
        const waResp = await sendAiSensyTemplate({
          campaignName: SOS_CAMPAIGN,
          destination: SUPPORT_PHONE,
          userName: "Badiyo Support",
          templateParams: [
            expert.name,
            expert.phone,
            body.booking_id ?? "N/A",
            timeStr,
            mapsLink,
          ],
        });
        console.log("[SOS] AiSensy raw response body:", waResp);
      } catch (waErr) {
        console.error("SOS WhatsApp send failed", waErr);
      }
    } else {
      console.warn("[SOS] BADIYO_SUPPORT_PHONE not configured — skipping WhatsApp send");
    }

    return json({ ok: true, alert_id: alert.id });
  } catch (err) {
    console.error("expert-sos-alert", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
