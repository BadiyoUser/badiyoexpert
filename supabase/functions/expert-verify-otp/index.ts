import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalize(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0+/, "").slice(-10);
}

function expertEmail(digits: string) {
  return `expert-${digits}@badiyo.internal`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, code } = await req.json();
    const digits = normalize(String(phone ?? ""));
    const otp = String(code ?? "").trim();
    if (digits.length !== 10 || otp.length !== 4) {
      return json({ error: "Invalid input" }, { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify code against the most recent unverified record for this phone.
    const { data: rows, error: qErr } = await admin
      .from("otp_codes")
      .select("id, code, is_verified, expires_at")
      .eq("phone", digits)
      .eq("is_verified", false)
      .order("created_at", { ascending: false })
      .limit(1);
    if (qErr) throw qErr;
    const record = rows?.[0];
    if (!record) return json({ error: "Code expired. Request a new one." }, { status: 400 });
    if (new Date(record.expires_at).getTime() < Date.now())
      return json({ error: "Code expired. Request a new one." }, { status: 400 });
    if (record.code !== otp) return json({ error: "Invalid code" }, { status: 400 });

    await admin.from("otp_codes").update({ is_verified: true }).eq("id", record.id);


    // Find expert
    const { data: experts, error: expErr } = await admin
      .from("experts")
      .select("id, auth_user_id, status")
      .or(`phone.eq.${digits},phone.eq.+91${digits},phone.eq.91${digits}`);
    if (expErr) throw expErr;
    const expert = experts?.find((e) => e.status === "active");
    if (!expert) return json({ error: "NOT_REGISTERED" }, { status: 403 });

    // Find or create auth user for this expert.
    const email = expertEmail(digits);
    let userId = expert.auth_user_id;
    if (!userId) {
      // Try to find an existing user by email.
      const { data: list } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
      if (existing) {
        userId = existing.id;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { expert_id: expert.id, expert_phone: digits },
        });
        if (cErr) throw cErr;
        userId = created.user!.id;
      }
      await admin.from("experts").update({ auth_user_id: userId }).eq("id", expert.id);
    }

    // Generate magic link and hand its token back to the client.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;
    const hashed_token = (linkData as { properties?: { hashed_token?: string } }).properties?.hashed_token;
    if (!hashed_token) throw new Error("Failed to mint session token");

    return json({ ok: true, email, token_hash: hashed_token });
  } catch (err) {
    console.error("expert-verify-otp", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
