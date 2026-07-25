import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Badiyo Expert" },
      { name: "description", content: "Your earnings and payout history." },
    ],
  }),
  component: WalletScreen,
});

function WalletScreen() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);

  const ledgerQ = useQuery({
    queryKey: ["ledger", expert?.id],
    enabled: !!expert?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_ledger")
        .select("id, amount, type, reason, created_at")
        .eq("owner_type", "expert")
        .eq("owner_id", expert!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const items = ledgerQ.data ?? [];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-8">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Wallet</h1>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] bg-primary p-6 text-primary-foreground shadow-[0_12px_32px_-12px_rgba(0,185,122,0.5)]">
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">Wallet balance</p>
          <p className="mt-2 text-[36px] font-bold leading-none">{formatINR(expert?.wallet_balance ?? 0)}</p>
          <p className="mt-2 text-[13px] opacity-85">Weekly payouts processed by the Badiyo team.</p>
        </div>
      </section>

      <section className="mt-6 px-6">
        <h2 className="text-[16px] font-bold text-foreground">Recent transactions</h2>
        {items.length === 0 ? (
          <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">No transactions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${t.type === "credit" ? "bg-[color:var(--color-accent)] text-primary" : "bg-red-50 text-red-600"}`}>
                  {t.type === "credit" ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-foreground">{t.reason ?? (t.type === "credit" ? "Credit" : "Debit")}</p>
                  <p className="text-[12px] text-[color:var(--text-secondary)]">{new Date(t.created_at).toLocaleString("en-IN")}</p>
                </div>
                <span className={`text-[15px] font-bold ${t.type === "credit" ? "text-primary" : "text-red-600"}`}>
                  {t.type === "credit" ? "+" : "−"}{formatINR(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
