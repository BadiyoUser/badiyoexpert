import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TRIGGER_SECRET = Deno.env.get("PUSH_TRIGGER_SECRET") ?? "";
const FIREBASE_SA_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedToken: { token: string; exp: number } | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(`FCM token exchange failed: ${JSON.stringify(j)}`);
  }
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // AuthN: shared trigger secret OR service-role bearer.
    const trig = req.headers.get("x-trigger-secret") ?? "";
    const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const okAuth =
      (TRIGGER_SECRET && trig && trig === TRIGGER_SECRET) ||
      (SERVICE_KEY && auth && auth === SERVICE_KEY);
    if (!okAuth) return json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      booking_id?: string;
      expert_id?: string;
    };
    if (!body.booking_id || !body.expert_id) {
      return json({ error: "booking_id and expert_id required" }, { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: tokens, error: tokErr } = await admin
      .from("expert_push_tokens")
      .select("fcm_token")
      .eq("expert_id", body.expert_id);
    if (tokErr) throw tokErr;
    if (!tokens || tokens.length === 0) {
      return json({ ok: true, sent: 0, reason: "no tokens" });
    }

    const { data: booking } = await admin
      .from("bookings")
      .select("id, scheduled_time_slot, service_duration_minutes, address_id")
      .eq("id", body.booking_id)
      .maybeSingle();

    let area = "";
    if (booking?.address_id) {
      const { data: addr } = await admin
        .from("addresses")
        .select("area, city")
        .eq("id", booking.address_id)
        .maybeSingle();
      area = [addr?.area, addr?.city].filter(Boolean).join(", ");
    }

    const bodyText =
      [
        booking?.service_duration_minutes ? `${booking.service_duration_minutes}-min service` : null,
        booking?.scheduled_time_slot,
        area,
      ]
        .filter(Boolean)
        .join(" · ") || "Tap to view details";

    if (!FIREBASE_SA_JSON) {
      console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping push send");
      return json({ ok: true, sent: 0, reason: "fcm not configured" });
    }

    const sa = JSON.parse(FIREBASE_SA_JSON) as ServiceAccount;
    const accessToken = await getAccessToken(sa);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    const failedTokens: string[] = [];
    for (const t of tokens) {
      const res = await fetch(fcmUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: t.fcm_token,
            notification: { title: "New booking assigned", body: bodyText },
            data: { booking_id: body.booking_id, type: "booking_assigned" },
            android: { priority: "HIGH", notification: { sound: "default" } },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default", "content-available": 1 } },
            },
          },
        }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        const errBody = await res.text();
        console.error("FCM send failed", res.status, errBody);
        if (res.status === 404 || res.status === 400) failedTokens.push(t.fcm_token);
      }
    }
    if (failedTokens.length > 0) {
      await admin.from("expert_push_tokens").delete().in("fcm_token", failedTokens);
    }

    return json({ ok: true, sent });
  } catch (err) {
    console.error("expert-send-push", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
