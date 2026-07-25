import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendAiSensyTemplate } from "../_shared/aisensy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CAMPAIGN = Deno.env.get("AISENSY_OTP_CAMPAIGN") ?? "badiyouserlogin";

function normalize(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0+/, "").slice(-10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone } = await req.json();
    const digits = normalize(String(phone ?? ""));
    if (digits.length !== 10) return json({ error: "Invalid phone number" }, { status: 400 });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Registered experts only: match by exact phone (any common shape).
    const { data: experts, error: expErr } = await admin
      .from("experts")
      .select("id, name, status")
      .or(`phone.eq.${digits},phone.eq.+91${digits},phone.eq.91${digits}`);
    if (expErr) throw expErr;
    const expert = experts?.find((e) => e.status === "active");
    if (!expert) {
      return json({ error: "NOT_REGISTERED" }, { status: 403 });
    }

    // Rate limit: max 3 sends per phone in the last 10 minutes.
    const tenAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("otp_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("phone", digits)
      .gte("created_at", tenAgo);
    if ((count ?? 0) >= 3) {
      return json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Invalidate previous unverified codes for this phone.
    await admin.from("otp_codes").update({ is_verified: true }).eq("phone", digits).eq("is_verified", false);
    const { error: insErr } = await admin.from("otp_codes").insert({
      phone: digits,
      code,
      is_verified: false,
      expires_at: expiresAt,
    });
    if (insErr) throw insErr;
    await admin.from("otp_rate_limits").insert({ phone: digits });

    await sendAiSensyTemplate({
      campaignName: CAMPAIGN,
      destination: `91${digits}`,
      userName: expert.name,
      templateParams: [code],
    });

    return json({ ok: true });
  } catch (err) {
    console.error("expert-send-otp", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
