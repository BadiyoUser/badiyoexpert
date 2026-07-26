import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalize(p: string) {
  return p.replace(/\D/g, "").replace(/^0+/, "").slice(-10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { phone } = await req.json();
    const digits = normalize(String(phone ?? ""));
    if (digits.length !== 10) return json({ error: "Invalid phone" }, { status: 400 });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("has_login_pin", { p_phone: digits });
    if (error) throw error;
    return json({ has_pin: !!data });
  } catch (err) {
    console.error("expert-check-pin", err);
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
