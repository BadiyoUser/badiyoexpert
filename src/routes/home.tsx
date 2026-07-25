import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Bell, Inbox, MapPin, Loader2, Wallet, History, Award, LifeBuoy, User, AlertTriangle } from "lucide-react";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, initials, formatINR } from "@/lib/expert-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Dashboard — Badiyo Expert" },
      { name: "description", content: "Go online and receive bookings." },
    ],
  }),
  component: HomeDashboard,
});

function HomeDashboard() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Real-time subscription to my assigned bookings
  useEffect(() => {
    if (!expert?.id) return;
    const ch = supabase
      .channel(`expert-${expert.id}-bookings`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `assigned_expert_id=eq.${expert.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["assigned-booking", expert.id] });
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
      const { error } = await supabase.rpc("expert_set_online", { _online: next });
      if (error) throw error;
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expert", userId] }),
  });

  if (loading || !userId) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const online = !!expert?.is_online;
  const assigned = assignedQ.data;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-6">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <img src={badiyoGreen.url} alt="Badiyo" className="h-7 w-auto" />
        <div className="flex items-center gap-3">
          <Link to="/sos" className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-destructive)]/10 text-[color:var(--color-destructive)]" aria-label="SOS">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.2} />
          </Link>
          <Link to="/profile" className="flex items-center gap-2 rounded-full bg-card border border-border py-1.5 pl-1.5 pr-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-charcoal)] text-[13px] font-bold text-white">
              {initials(expert?.name)}
            </div>
            <span className="text-[13px] font-semibold text-foreground">{expert?.name?.split(" ")[0] ?? "Expert"}</span>
          </Link>
        </div>
      </header>

      <section className="px-6">
        <div
          className="rounded-[18px] border p-6 transition"
          style={{
            backgroundColor: online ? "#00B97A" : "#FFFFFF",
            borderColor: online ? "#00B97A" : "#E5E7EB",
            boxShadow: online ? "0 12px 32px -12px rgba(0,185,122,0.5)" : "0 4px 16px -8px rgba(34,40,49,0.08)",
          }}
        >
          <p className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: online ? "rgba(255,255,255,0.85)" : "#6B7280" }}>Status</p>
          <p className="mt-1 text-[26px] font-bold leading-tight" style={{ color: online ? "#FFFFFF" : "#222831" }}>
            {online ? "You're online" : "You're offline"}
          </p>
          <p className="mt-1 text-[14px]" style={{ color: online ? "rgba(255,255,255,0.85)" : "#6B7280" }}>
            {online ? "Ready to receive bookings" : "Go online to start receiving bookings"}
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={online}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!online)}
            className="mt-6 flex h-[52px] w-full items-center justify-between rounded-[14px] px-2 transition disabled:opacity-60"
            style={{ backgroundColor: online ? "rgba(255,255,255,0.18)" : "#F1F5F9" }}
          >
            <span className="pl-3 text-[15px] font-bold" style={{ color: online ? "#FFFFFF" : "#222831" }}>
              {toggle.isPending ? "Updating…" : online ? "Tap to go offline" : "Tap to go online"}
            </span>
            <span className="relative flex h-10 w-[72px] items-center rounded-full transition" style={{ backgroundColor: online ? "#FFFFFF" : "#E5E7EB" }}>
              <span
                className="absolute h-8 w-8 rounded-full shadow-md transition-all"
                style={{ left: online ? "36px" : "4px", backgroundColor: online ? "#00B97A" : "#FFFFFF" }}
              />
            </span>
          </button>
        </div>
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
              <span className="text-[16px] font-bold text-foreground">{formatINR(assigned.price)}</span>
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
          <h2 className="mt-5 text-[20px] font-bold text-foreground">Waiting for a booking</h2>
          <p className="mt-2 max-w-xs text-[14px] text-[color:var(--text-secondary)]">
            {online ? "New requests from nearby customers will appear here." : "Turn on your availability to start getting requests."}
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
    </div>
  );
}
