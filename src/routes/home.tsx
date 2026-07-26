import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Inbox, MapPin, Loader2, Wallet, History, Award, LifeBuoy, Clock, X, AlertTriangle } from "lucide-react";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, initials } from "@/lib/expert-client";
import {
  haversineKm,
  startNotificationLoop,
  stopAllNotificationLoops,
  useExpertLocationTracking,
  type Coords,
} from "@/lib/broadcast";
import { initExpertPush } from "@/lib/push";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Dashboard — Badiyo Expert" },
      { name: "description", content: "Go online and receive bookings." },
    ],
  }),
  component: HomeDashboard,
});

type BroadcastBooking = {
  id: string;
  status: string;
  service_duration_minutes: number | null;
  scheduled_time_slot: string | null;
  slot_type: string | null;
  address_id: string | null;
  booking_lat: number | null;
  booking_lng: number | null;
  assigned_expert_id: string | null;
};

type BroadcastCandidate = {
  booking: BroadcastBooking;
  address: { full_address: string | null; area: string | null; city: string | null } | null;
  distanceKm: number;
  soundHandle: { stop: () => void };
};

function HomeDashboard() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;
    void initExpertPush((opts) => navigate(opts as Parameters<typeof navigate>[0]));
  }, [userId, navigate]);

  const online = !!expert?.is_online;
  const isBusy = !!expert?.is_busy;
  const tracker = useExpertLocationTracking(online);
  const locationState = tracker.state;
  const coordsRef = useRef<Coords | null>(null);
  useEffect(() => {
    coordsRef.current = locationState.status === "ok" ? locationState.coords : null;
  }, [locationState]);

  // "Fresh" = we successfully persisted a fix within the last 2 minutes.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!online) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [online]);
  const locationFresh =
    tracker.lastPushedAt != null &&
    (tracker.isHidden || nowTick - tracker.lastPushedAt < 120_000);

  // Broadcast radius (fetched once)
  const { data: dispatchCfg } = useQuery({
    queryKey: ["dispatch-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispatch_config")
        .select("broadcast_radius_km")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const radiusKm = Number(dispatchCfg?.broadcast_radius_km ?? 5);

  // Broadcast queue
  const [candidates, setCandidates] = useState<BroadcastCandidate[]>([]);
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const dismissedRef = useRef<Set<string>>(new Set());

  const removeCandidate = useCallback((bookingId: string) => {
    setCandidates((prev) => {
      const target = prev.find((c) => c.booking.id === bookingId);
      target?.soundHandle.stop();
      return prev.filter((c) => c.booking.id !== bookingId);
    });
  }, []);

  const dismissCandidate = useCallback((bookingId: string) => {
    dismissedRef.current.add(bookingId);
    removeCandidate(bookingId);
  }, [removeCandidate]);

  const evaluateBooking = useCallback(
    async (booking: BroadcastBooking) => {
      if (!online) return;
      if (isBusy) return;
      if (dismissedRef.current.has(booking.id)) return;
      if (candidatesRef.current.some((c) => c.booking.id === booking.id)) return;
      if (booking.assigned_expert_id) return;
      if (booking.status !== "accepted") return;
      const myCoords = coordsRef.current;
      if (!myCoords) return;
      if (booking.booking_lat == null || booking.booking_lng == null) return;
      const distanceKm = haversineKm(myCoords, {
        lat: Number(booking.booking_lat),
        lng: Number(booking.booking_lng),
      });
      if (distanceKm > radiusKm) return;

      let address: BroadcastCandidate["address"] = null;
      if (booking.address_id) {
        const { data } = await supabase
          .from("addresses")
          .select("full_address, area, city")
          .eq("id", booking.address_id)
          .maybeSingle();
        address = data ?? null;
      }
      const soundHandle = startNotificationLoop();
      setCandidates((prev) => {
        if (prev.some((c) => c.booking.id === booking.id)) {
          soundHandle.stop();
          return prev;
        }
        return [...prev, { booking, address, distanceKm, soundHandle }];
      });
    },
    [online, isBusy, radiusKm],
  );

  // Subscribe to broadcast events while online
  useEffect(() => {
    if (!online || !expert?.id) return;
    const ch = supabase
      .channel(`expert-${expert.id}-broadcast`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bookings" },
        (payload) => {
          void evaluateBooking(payload.new as BroadcastBooking);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings" },
        (payload) => {
          const row = payload.new as BroadcastBooking;
          const existing = candidatesRef.current.find((c) => c.booking.id === row.id);
          if (existing && row.assigned_expert_id) {
            removeCandidate(row.id);
            toast.info("This booking was accepted by another expert.");
            return;
          }
          void evaluateBooking(row);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [online, expert?.id, evaluateBooking, removeCandidate]);

  // Catch-up fetch: realtime only delivers events fired AFTER subscribe. If the
  // expert opens the app (cold start / notification tap) while a booking is
  // already broadcasting, back-fill it here so the card still shows.
  useEffect(() => {
    if (!online || !expert?.id || isBusy) return;
    if (locationState.status !== "ok") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, status, service_duration_minutes, scheduled_time_slot, slot_type, address_id, booking_lat, booking_lng, assigned_expert_id",
        )
        .eq("status", "accepted")
        .is("assigned_expert_id", null)
        .limit(50);
      if (cancelled || error || !data) return;
      for (const row of data) {
        void evaluateBooking(row as BroadcastBooking);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, expert?.id, isBusy, locationState.status, evaluateBooking]);

  // Cleanup all sounds when going offline / unmounting
  useEffect(() => {
    if (!online || isBusy) {
      candidatesRef.current.forEach((c) => c.soundHandle.stop());
      setCandidates([]);
      dismissedRef.current.clear();
    }
  }, [online, isBusy]);
  useEffect(() => () => stopAllNotificationLoops(), []);

  // Periodic re-verification: RLS hides UPDATE events for bookings claimed by
  // other experts (row no longer matches the public unassigned policy), so
  // realtime never tells us they were taken. Poll the currently-displayed
  // candidates and drop any that are no longer accepted-and-unassigned.
  useEffect(() => {
    if (!online || isBusy) return;
    const interval = window.setInterval(async () => {
      const ids = candidatesRef.current.map((c) => c.booking.id);
      if (ids.length === 0) return;
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, assigned_expert_id")
        .in("id", ids);
      if (error) return;
      const stillValid = new Set(
        (data ?? [])
          .filter((r) => r.status === "accepted" && r.assigned_expert_id == null)
          .map((r) => r.id as string),
      );
      for (const id of ids) {
        if (!stillValid.has(id)) removeCandidate(id);
      }
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [online, isBusy, removeCandidate]);

  // Existing assigned-booking subscription (unchanged)
  useEffect(() => {
    if (!expert?.id) return;
    const ch = supabase
      .channel(`expert-${expert.id}-bookings`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `assigned_expert_id=eq.${expert.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["assigned-booking", expert.id] });
          qc.invalidateQueries({ queryKey: ["expert", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [expert?.id, qc]);

  const assignedQ = useQuery({
    queryKey: ["assigned-booking", expert?.id],
    enabled: !!expert?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, service_duration_minutes, price, address_id, created_at")
        .eq("assigned_expert_id", expert!.id)
        .in("status", ["expert_assigned", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      try {
        if (next) {
          // Outer safety net: whatever hangs — permission dialog, GPS fix,
          // or the RPC — this guarantees the mutation settles in ≤20s so the
          // UI can never stay in "Updating…" forever.
          await Promise.race([
            (async () => {
              await tracker.ensureFix();
              const { error } = await supabase.rpc("expert_set_online", { _online: true });
              if (error) throw error;
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Toggle timed out after 20s")), 20_000),
            ),
          ]);
          return next;
        }
        const { error } = await supabase.rpc("expert_set_online", { _online: false });
        if (error) throw error;
        return next;
      } catch (err) {
        console.warn("[expert][toggle] failed", err);
        throw err;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expert", userId] }),
    onError: (err: Error) => {
      const msg = err.message || "";
      if (/permission/i.test(msg) || /denied/i.test(msg)) {
        toast.error("Couldn't get your location — check permissions and try again.");
      } else if (/timed out/i.test(msg) || /timeout/i.test(msg)) {
        toast.error("Couldn't get your location — move to an open area and try again.");
      } else {
        toast.error(msg || "Could not update your status.");
      }
    },
  });


  const acceptBroadcast = useMutation({
    mutationFn: async (bookingId: string) => {
      if (!expert?.id) throw new Error("Expert profile unavailable");
      const { error } = await supabase.rpc("claim_booking_as_expert", {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      return bookingId;
    },
    onSuccess: (bookingId) => {
      removeCandidate(bookingId);
      qc.invalidateQueries({ queryKey: ["assigned-booking", expert?.id] });
      navigate({ to: "/booking/$id", params: { id: bookingId } });
    },
    onError: (err: Error, bookingId) => {
      removeCandidate(bookingId);
      toast.error(err.message || "Could not accept this booking.");
    },
  });

  if (loading || !userId) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const assigned = assignedQ.data;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <img src={badiyoGreen.url} alt="Badiyo" className="h-7 w-auto" />
        <Link to="/profile" className="rounded-full" aria-label="Profile">
          {expert?.photo_url ? (
            <img src={expert.photo_url} alt={expert.name ?? "Expert"} className="h-9 w-9 rounded-full object-cover border border-border" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--color-charcoal)] text-[13px] font-bold text-white">
              {initials(expert?.name)}
            </div>
          )}
        </Link>
      </header>

      <section className="px-6">
        <div
          className={`rounded-[18px] border p-6 transition ${
            online
              ? "border-primary bg-primary shadow-[var(--shadow-brand-md)]"
              : "border-border bg-card shadow-[var(--shadow-card)]"
          }`}
        >
          <p
            className={`text-[13px] font-semibold uppercase tracking-wider ${
              online ? "text-primary-foreground/85" : "text-muted-foreground"
            }`}
          >
            Status
          </p>
          <p
            className={`mt-1 text-[26px] font-bold leading-tight ${
              online ? "text-primary-foreground" : "text-foreground"
            }`}
          >
            {online ? "You're online" : "You're offline"}
          </p>
          <p
            className={`mt-1 text-[14px] ${
              online ? "text-primary-foreground/85" : "text-muted-foreground"
            }`}
          >
            {online ? "Ready to receive bookings" : "Go online to start receiving bookings"}
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={online}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!online)}
            className={`mt-6 flex h-[52px] w-full items-center justify-between rounded-[14px] px-2 transition disabled:opacity-60 ${
              online ? "bg-primary-foreground/20" : "bg-muted"
            }`}
          >
            <span
              className={`pl-3 text-[15px] font-bold ${
                online ? "text-primary-foreground" : "text-foreground"
              }`}
            >
              {toggle.isPending ? "Updating…" : online ? "Tap to go offline" : "Tap to go online"}
            </span>
            <span
              className={`relative flex h-10 w-[72px] items-center rounded-full transition ${
                online ? "bg-primary-foreground" : "bg-border"
              }`}
            >
              <span
                className={`absolute h-8 w-8 rounded-full shadow-md transition-all ${
                  online ? "bg-primary" : "bg-card"
                }`}
                style={{ left: online ? "36px" : "4px" }}
              />
            </span>
          </button>
        </div>

        {online && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-[14px] border p-3 ${
              locationFresh
                ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]"
                : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
            }`}
          >
            {locationFresh ? (
              <MapPin className="mt-0.5 h-4 w-4 text-[color:var(--success)]" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 text-[color:var(--warning-icon)]" />
            )}
            <p
              className={`text-[13px] font-semibold ${
                locationFresh
                  ? "text-[color:var(--success-strong)]"
                  : "text-[color:var(--warning-strong)]"
              }`}
            >
              {locationFresh
                ? "Location active — you'll receive nearby job requests."
                : locationState.status === "denied"
                  ? "Location permission denied. Enable location access in your browser settings — you won't receive job requests until this is resolved."
                  : locationState.status === "unavailable"
                    ? `${locationState.message} — you won't receive job requests until this is resolved.`
                    : locationState.status === "requesting"
                      ? "Getting your location…"
                      : "Location unavailable — you won't receive job requests until this is resolved."}
            </p>
          </div>
        )}

      </section>

      {assigned ? (
        <section className="mt-6 px-6">
          <button
            onClick={() => navigate({ to: "/booking/$id", params: { id: assigned.id } })}
            className="w-full rounded-[18px] border border-border bg-card p-5 text-left shadow-[0_4px_16px_-8px_rgba(34,40,49,0.08)] transition active:scale-[0.99]"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-[color:var(--color-accent)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                {assigned.status === "in_progress" ? "In progress" : "New booking"}
              </span>
            </div>
            <p className="mt-3 text-[18px] font-bold text-foreground">{assigned.service_duration_minutes}-min service</p>
            <div className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-[color:var(--text-secondary)]">
              <MapPin className="h-4 w-4" /> Tap to view details
            </div>
          </button>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
            <Inbox className="h-9 w-9 text-primary" strokeWidth={2} />
          </div>
          <h2 className="mt-5 text-[20px] font-bold text-foreground">
            {isBusy ? "Active booking in progress" : "Waiting for a booking"}
          </h2>
          <p className="mt-2 max-w-xs text-[14px] text-[color:var(--text-secondary)]">
            {isBusy
              ? "New requests are paused until your current booking is complete."
              : online ? "New requests from nearby customers will appear here." : "Turn on your availability to start getting requests."}
          </p>
        </section>
      )}

      <nav className="mt-6 grid grid-cols-4 gap-2 px-6">
        {[
          { to: "/history" as const, label: "History", Icon: History },
          { to: "/wallet" as const, label: "Wallet", Icon: Wallet },
          { to: "/rewards" as const, label: "Rewards", Icon: Award },
          { to: "/support" as const, label: "Help", Icon: LifeBuoy },
        ].map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-1 rounded-[14px] border border-border bg-card py-3 text-center">
            <Icon className="h-5 w-5 text-primary" strokeWidth={2} />
            <span className="text-[12px] font-semibold text-foreground">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Broadcast overlay stack — scrolls within available space above the bottom nav */}
      {candidates.length > 0 && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgba(34,40,49,0.55)] backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-md flex-col gap-3 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)]" style={{ maxHeight: "100dvh" }}>

            {candidates.map((c) => (
              <div
                key={c.booking.id}
                className="rounded-[18px] border border-border bg-card p-5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.4)] animate-in slide-in-from-bottom-4"
              >
                <div className="flex items-start justify-between">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                    New booking request
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => dismissCandidate(c.booking.id)}
                    className="rounded-full p-1 text-[color:var(--text-secondary)] hover:bg-[color:var(--divider)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[15px] font-bold text-foreground">
                  <Clock className="h-4 w-4 text-primary" />
                  {c.booking.service_duration_minutes ?? "—"}-min service
                  {c.booking.scheduled_time_slot ? ` · ${c.booking.scheduled_time_slot}` : ""}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-[14px] bg-[color:var(--divider)] p-3">
                  <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="text-[13px] leading-snug text-foreground">
                    <p className="font-semibold">{c.address?.full_address ?? "Customer address"}</p>
                    {(c.address?.area || c.address?.city) && (
                      <p className="text-[color:var(--text-secondary)]">
                        {[c.address?.area, c.address?.city].filter(Boolean).join(", ")}
                      </p>
                    )}
                    <p className="mt-1 text-[12px] font-semibold text-[color:var(--text-secondary)]">
                      {c.distanceKm.toFixed(1)} km away
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => dismissCandidate(c.booking.id)}
                    className="h-[52px] flex-1 rounded-[14px] border border-border bg-card text-[15px] font-bold text-foreground"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={acceptBroadcast.isPending}
                    onClick={() => acceptBroadcast.mutate(c.booking.id)}
                    className="h-[52px] flex-[1.4] rounded-[14px] bg-primary text-[15px] font-bold text-white disabled:opacity-60"
                  >
                    {acceptBroadcast.isPending ? "Accepting…" : "Accept"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


