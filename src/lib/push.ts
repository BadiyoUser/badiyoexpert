import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type NavigateFn = (opts: { to: string; params?: Record<string, string> }) => void;

let initialized = false;

async function registerToken(fcmToken: string, platform: string) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;
  await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/expert-register-push-token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ fcm_token: fcmToken, platform }),
    },
  ).catch((err) => console.warn("register push token failed", err));
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

  await PushNotifications.addListener("registration", (t) => {
    void registerToken(t.value, platform);
  });
  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("push registration error", err);
  });
  await PushNotifications.addListener("pushNotificationReceived", (n) => {
    const bookingId = (n.data as { booking_id?: string } | undefined)?.booking_id;
    toast.message(n.title ?? "New booking assigned", {
      description: n.body ?? undefined,
      action: bookingId
        ? { label: "View", onClick: () => navigate({ to: "/booking/$id", params: { id: bookingId } }) }
        : undefined,
    });
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const bookingId = (action.notification.data as { booking_id?: string } | undefined)?.booking_id;
    if (bookingId) navigate({ to: "/booking/$id", params: { id: bookingId } });
  });
}
