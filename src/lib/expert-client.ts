import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callFn<T>(name: string, body: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  };
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  }
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return json as T;
}

export const expertApi = {
  sendOtp: (phone: string) => callFn<{ ok: boolean }>("expert-send-otp", { phone }, { auth: false }),
  verifyOtp: (phone: string, code: string) =>
    callFn<{ ok: boolean; email: string; token_hash: string }>(
      "expert-verify-otp",
      { phone, code },
      { auth: false },
    ),
  checkPin: (phone: string) =>
    callFn<{ has_pin: boolean }>("expert-check-pin", { phone }, { auth: false }),
  verifyPin: (phone: string, pin: string) =>
    callFn<{ ok: boolean; email: string; token_hash: string }>(
      "expert-verify-pin",
      { phone, pin },
      { auth: false },
    ),
  sosAlert: (input: {
    booking_id?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    notes?: string | null;
  }) => callFn<{ ok: boolean; alert_id: string }>("expert-sos-alert", input),
};

// Session hook
export function useExpertSession(options: { redirect?: boolean } = { redirect: true }) {
  const [state, setState] = useState<{ loading: boolean; userId: string | null }>({
    loading: true,
    userId: null,
  });
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const uid = data.session?.user?.id ?? null;
      setState({ loading: false, userId: uid });
      if (!uid && options.redirect) navigate({ to: "/login" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      const uid = session?.user?.id ?? null;
      setState({ loading: false, userId: uid });
      if (!uid && options.redirect) navigate({ to: "/login" });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

// Expert profile query keyed on auth user id
export function useExpert(authUserId: string | null) {
  return useQuery({
    queryKey: ["expert", authUserId],
    enabled: !!authUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("experts")
        .select(
          "id, name, phone, photo_url, level, wallet_balance, is_online, is_busy, kyc_status, address, zone_id",
        )
        .eq("auth_user_id", authUserId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function initials(name?: string | null): string {
  if (!name) return "E";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "E";
}

export function formatINR(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
