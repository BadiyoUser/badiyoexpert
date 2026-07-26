import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type NavigateFn = (opts: { to: string; params?: Record<string, string> }) => void;

const LAST_REG_KEY = "expert_push_last_registered_at";
const STALE_MS = 24 * 60 * 60 * 1000;

let initialized = false;
let currentToken: string | null = null;
let currentPlatform: string | null = null;

async function callRegister(fcmToken: string, platform: string) {
  const { error } = await supabase.rpc("register_device_token", {
    p_fcm_token: fcmToken,
    p_platform: platform,
  });
  if (error) {
    console.warn("register_device_token failed", error);
    return false;
  }
  try {
    localStorage.setItem(LAST_REG_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  return true;
}

async function maybeRefreshIfStale() {
  if (!currentToken || !currentPlatform) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_REG_KEY) ?? "0");
  } catch {
    /* ignore */
  }
  if (!last || Date.now() - last > STALE_MS) {
    await callRegister(currentToken, currentPlatform);
  }
}

function routeFromData(
  data: unknown,
  navigate: NavigateFn,
): (() => void) | undefined {
  const d = (data ?? {}) as { route?: string; booking_id?: string; type?: string };
  // Broadcast notifications are for unassigned bookings — always land on Home,
  // where the broadcast card stack will surface eligible bookings. Never route
  // to a booking-detail view (the expert isn't assigned yet, so it 403s).
  if (d.type === "new_booking_broadcast") {
    return () => navigate({ to: "/home" });
  }
  if (d.booking_id) {
    return () => navigate({ to: "/booking/$id", params: { id: d.booking_id! } });
  }
  if (typeof d.route === "string" && d.route.length > 0) {
    const route = d.route;
    const bookingMatch = route.match(/^\/?booking\/([^/?#]+)/);
    if (bookingMatch) {
      return () => navigate({ to: "/booking/$id", params: { id: bookingMatch[1] } });
    }
    return () => navigate({ to: route.startsWith("/") ? route : `/${route}` });
  }
  return undefined;
}

export async function initExpertPush(navigate: NavigateFn) {
  if (initialized) return;
  let Capacitor: typeof import("@capacitor/core").Capacitor | null = null;
  try {
    const mod = await import("@capacitor/core");
    Capacitor = mod.Capacitor;
  } catch {
    return;
  }
  if (!Capacitor?.isNativePlatform?.()) return;
  initialized = true;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  const perm = await PushNotifications.checkPermissions();
  let granted = perm.receive === "granted";
  if (!granted) {
    const req = await PushNotifications.requestPermissions();
    granted = req.receive === "granted";
  }
  if (!granted) return;

  await PushNotifications.register();

  const platform = Capacitor.getPlatform();
  currentPlatform = platform;

  await PushNotifications.addListener("registration", (t) => {
    currentToken = t.value;
    void callRegister(t.value, platform);
  });
  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("push registration error", err);
  });
  await PushNotifications.addListener("pushNotificationReceived", (n) => {
    // Foreground handler for non-broadcast notifications
    // (cancellations, admin messages, etc.). The new-booking broadcast has
    // its own realtime+sound flow on Home and does not need a toast.
    const data = n.data as { type?: string } | undefined;
    if (data?.type === "new_booking_broadcast") return;
    const onClick = routeFromData(n.data, navigate);
    toast.message(n.title ?? "Notification", {
      description: n.body ?? undefined,
      action: onClick ? { label: "Open", onClick } : undefined,
    });
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const onClick = routeFromData(action.notification.data, navigate);
    if (onClick) onClick();
  });

  // Re-register on foreground if last registration is stale (>24h).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void maybeRefreshIfStale();
  });
}
