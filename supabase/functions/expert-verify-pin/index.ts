import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalize(p: string) {
  return p.replace(/\D/g, "").replace(/^0+/, "").slice(-10);
}
function expertEmail(digits: string) {
  return `expert-${digits}@badiyos.internal`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { phone, pin } = await req.json();
    const digits = normalize(String(phone ?? ""));
    const p = String(pin ?? "").trim();
    if (digits.length !== 10 || !/^\d{4}$/.test(p)) {
      return json({ error: "Invalid input" }, { status: 400 });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: result, error } = await admin.rpc("verify_login_pin_internal", {
      p_phone: digits,
      p_pin: p,
    });
    if (error) throw error;
    const res = result as {
      ok: boolean;
      error?: string;
      retry_after_seconds?: number;
      attempts_left?: number;
      auth_user_id?: string | null;
    };
    if (!res.ok) {
      if (res.error === "LOCKED") {
        const secs = res.retry_after_seconds ?? 900;
        return json(
          { error: `Too many wrong attempts. Try again in ${secs} seconds.`, retry_after_seconds: secs },
          { status: 429 },
        );
      }
      if (res.error === "NOT_REGISTERED") return json({ error: "NOT_REGISTERED" }, { status: 403 });
      if (res.error === "NO_PIN") return json({ error: "NO_PIN" }, { status: 400 });
      return json(
        { error: "Incorrect PIN", attempts_left: res.attempts_left },
        { status: 400 },
      );
    }

    // Mint magic link for session (matches OTP flow).
    const email = expertEmail(digits);
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;
    const token_hash = (linkData as { properties?: { hashed_token?: string } }).properties?.hashed_token;
    if (!token_hash) throw new Error("Failed to mint session token");
    return json({ ok: true, email, token_hash });
  } catch (err) {
    console.error("expert-verify-pin", err);
    return json({ error: (err as Error).message }, { status: 500 });
  }
});
