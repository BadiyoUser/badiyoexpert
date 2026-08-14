import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Badiyo Expert" },
      { name: "description", content: "Your earnings and payout history." },
    ],
  }),
  component: WalletScreen,
});

// Replaces any 8+ hex-char UUID-ish token inside a reason label with a short
// "#xxxxxx" tag (first 6 chars), matching the Command Center booking-id style.
const UUID_RE = /\b[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}\b/gi;
function formatReason(reason: string | null, type: "credit" | "debit" | string, fallback: { credit: string; debit: string }): string {
  if (!reason) return type === "credit" ? fallback.credit : fallback.debit;
  return reason.replace(UUID_RE, (uuid) => `#${uuid.replace(/-/g, "").slice(0, 6)}`);
}

function WalletScreen() {
  const t = useT();
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

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const items = ledgerQ.data ?? [];

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">{t("wallet.title")}</h1>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] bg-primary p-6 text-primary-foreground shadow-[var(--shadow-brand-md)]">
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">{t("wallet.balance.label")}</p>
          <p className="mt-2 text-[36px] font-bold leading-none">{formatINR(expert?.wallet_balance ?? 0)}</p>
          <p className="mt-2 text-[13px] opacity-85">{t("wallet.balance.note")}</p>
        </div>
      </section>

      <section className="mt-6 px-6">
        <h2 className="text-[16px] font-bold text-foreground">{t("wallet.tx.title")}</h2>
        {items.length === 0 ? (
          <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">{t("wallet.tx.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tx.type === "credit" ? "bg-[color:var(--color-accent)] text-primary" : "bg-red-50 text-red-600"}`}>
                  {tx.type === "credit" ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-foreground">{formatReason(tx.reason, tx.type, { credit: t("wallet.credit"), debit: t("wallet.debit") })}</p>
                  <p className="text-[12px] text-[color:var(--text-secondary)]">{new Date(tx.created_at).toLocaleString("en-IN")}</p>
                </div>
                <span className={`text-[15px] font-bold ${tx.type === "credit" ? "text-primary" : "text-red-600"}`}>
                  {tx.type === "credit" ? "+" : "−"}{formatINR(tx.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
