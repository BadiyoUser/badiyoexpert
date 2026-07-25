import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { data: expert } = await admin
      .from("experts")
      .select("id")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (!expert) return json({ error: "Expert profile not found" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as {
      fcm_token?: string;
      platform?: string;
    };
    const fcm = (body.fcm_token ?? "").trim();
    if (!fcm) return json({ error: "fcm_token required" }, { status: 400 });

    const { error: upErr } = await admin
      .from("expert_push_tokens")
      .upsert(
        {
          expert_id: expert.id,
          fcm_token: fcm,
          platform: body.platform ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "fcm_token" },
      );
    if (upErr) throw upErr;

    return json({ ok: true });
  } catch (err) {
    console.error("expert-register-push-token", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
