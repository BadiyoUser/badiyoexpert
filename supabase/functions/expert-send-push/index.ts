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
      /** "assigned" (manual/direct assignment) or "broadcast" (nearby offer). */
      alert_type?: "assigned" | "broadcast";
      title?: string;
      body?: string;
    };
    if (!body.booking_id || !body.expert_id) {
      return json({ error: "booking_id and expert_id required" }, { status: 400 });
    }
    const alertType: "assigned" | "broadcast" =
      body.alert_type === "broadcast" ? "broadcast" : "assigned";


    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Read FCM tokens from BOTH the shared `device_tokens` table (written by
    // the current client via the shared `register_device_token` RPC — this is
    // where every fresh registration now lands) AND the legacy
    // `expert_push_tokens` table (populated by the older
    // `expert-register-push-token` edge fn — kept for back-compat with any
    // tokens that never re-registered). De-dupe by token.
    const expertRow = await admin
      .from("experts")
      .select("auth_user_id")
      .eq("id", body.expert_id)
      .maybeSingle();
    const authUserId = expertRow.data?.auth_user_id ?? null;

    const [dtRes, eptRes] = await Promise.all([
      authUserId
        ? admin
            .from("device_tokens")
            .select("fcm_token")
            .eq("user_type", "expert")
            .eq("user_id", authUserId)
        : Promise.resolve({ data: [] as { fcm_token: string }[], error: null }),
      admin.from("expert_push_tokens").select("fcm_token").eq("expert_id", body.expert_id),
    ]);
    if (dtRes.error) console.error("expert-send-push device_tokens error", dtRes.error);
    if (eptRes.error) console.error("expert-send-push expert_push_tokens error", eptRes.error);

    const tokenSet = new Set<string>();
    for (const r of dtRes.data ?? []) if (r.fcm_token) tokenSet.add(r.fcm_token);
    for (const r of eptRes.data ?? []) if (r.fcm_token) tokenSet.add(r.fcm_token);
    const tokens = Array.from(tokenSet).map((t) => ({ fcm_token: t }));

    console.log(
      `expert-send-push tokens: expert_id=${body.expert_id} auth_user_id=${authUserId} device_tokens=${dtRes.data?.length ?? 0} expert_push_tokens=${eptRes.data?.length ?? 0} unique=${tokens.length}`,
    );
    if (tokens.length === 0) {
      return json({ ok: true, sent: 0, reason: "no tokens" });
    }


    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, scheduled_time_slot, service_duration_minutes, address_id, booking_lat, booking_lng",
      )
      .eq("id", body.booking_id)
      .maybeSingle();

    let area = "";
    let fullAddress = "";
    if (booking?.address_id) {
      const { data: addr } = await admin
        .from("addresses")
        .select("full_address, area, city")
        .eq("id", booking.address_id)
        .maybeSingle();
      area = [addr?.area, addr?.city].filter(Boolean).join(", ");
      fullAddress = addr?.full_address ?? "";
    }

    const durationText = booking?.service_duration_minutes
      ? booking.service_duration_minutes >= 60 &&
        booking.service_duration_minutes % 60 === 0
        ? `${booking.service_duration_minutes / 60}h service`
        : `${booking.service_duration_minutes}-min service`
      : "";

    const bodyText =
      body.body ||
      [durationText, booking?.scheduled_time_slot, area]
        .filter(Boolean)
        .join(" · ") ||
      "Tap to view details";
    const titleText =
      body.title ||
      (alertType === "broadcast" ? "New booking nearby" : "New booking assigned");

    // Ring timeout for the native full-screen alert: the dispatcher expands the
    // search radius after this many seconds, so the device simply stops ringing.
    let timeoutSeconds = 60;
    {
      const { data: cfg } = await admin
        .from("dispatch_config")
        .select("radius_expand_after_seconds")
        .limit(1)
        .maybeSingle();
      if (cfg?.radius_expand_after_seconds && cfg.radius_expand_after_seconds > 0) {
        timeoutSeconds = cfg.radius_expand_after_seconds;
      }
    }

    if (!FIREBASE_SA_JSON) {
      console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping push send");
      return json({ ok: true, sent: 0, reason: "fcm not configured" });
    }

    const sa = JSON.parse(FIREBASE_SA_JSON) as ServiceAccount;
    const accessToken = await getAccessToken(sa);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    // DATA-ONLY message. No `notification` block: the Android client
    // (BadiyoMessagingService) builds the full-screen ringing notification
    // itself, so the OS never posts a plain heads-up on our behalf.
    // FCM data values must all be strings.
    const dataPayload: Record<string, string> = {
      type: alertType === "broadcast" ? "new_booking_broadcast" : "booking_assigned",
      alert_type: alertType,
      booking_id: body.booking_id,
      expert_id: body.expert_id,
      title: titleText,
      body: bodyText,
      address: fullAddress || area,
      area,
      duration: durationText,
      slot: booking?.scheduled_time_slot ?? "",
      lat: booking?.booking_lat != null ? String(booking.booking_lat) : "",
      lng: booking?.booking_lng != null ? String(booking.booking_lng) : "",
      timeout_seconds: String(timeoutSeconds),
      route: alertType === "broadcast" ? "home" : `/booking/${body.booking_id}`,
    };

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
            data: dataPayload,
            android: {
              priority: "HIGH",
              ttl: `${timeoutSeconds}s`,
              direct_boot_ok: true,
            },
            apns: {
              headers: { "apns-priority": "10", "apns-push-type": "alert" },
              payload: {
                aps: {
                  alert: { title: titleText, body: bodyText },
                  sound: "default",
                  "interruption-level": "time-sensitive",
                },
              },
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
      console.warn(`expert-send-push pruning ${failedTokens.length} invalid tokens`);
      await admin.from("expert_push_tokens").delete().in("fcm_token", failedTokens);
      await admin.from("device_tokens").delete().in("fcm_token", failedTokens);
    }
    console.log(`expert-send-push done: sent=${sent}/${tokens.length}`);


    return json({ ok: true, sent });
  } catch (err) {
    console.error("expert-send-push", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
});
