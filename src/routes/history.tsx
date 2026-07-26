import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Booking history — Badiyo Expert" },
      { name: "description", content: "Your past bookings and earnings." },
    ],
  }),
  component: HistoryScreen,
});

function HistoryScreen() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);

  const q = useQuery({
    queryKey: ["history", expert?.id],
    enabled: !!expert?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, price, service_duration_minutes, created_at, updated_at")
        .eq("assigned_expert_id", expert!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const items = q.data ?? [];

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Booking history</h1>
      </header>

      <div className="px-6">
        {items.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-[16px] font-semibold text-foreground">No bookings yet</p>
            <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">Completed jobs will appear here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((b) => (
              <li key={b.id} className="rounded-[18px] border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    b.status === "completed" ? "bg-[color:var(--color-accent)] text-primary"
                    : b.status === "cancelled" || b.status === "rejected" ? "bg-red-50 text-red-600"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {b.status.replace("_", " ")}
                  </span>
                  <span className="text-[16px] font-bold text-foreground">{formatINR(b.price)}</span>
                </div>
                <p className="mt-2 text-[15px] font-semibold text-foreground">{b.service_duration_minutes}-minute service</p>
                <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{b.created_at ? new Date(b.created_at).toLocaleString("en-IN") : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
