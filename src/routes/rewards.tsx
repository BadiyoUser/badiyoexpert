import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Award, Star, Zap, Gift } from "lucide-react";

export const Route = createFileRoute("/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards — Badiyo Expert" },
      { name: "description", content: "Level up and unlock rewards on Badiyo." },
    ],
  }),
  component: RewardsScreen,
});

function RewardsScreen() {
  const level = "Bronze";
  const jobs = 12;
  const nextLevel = "Silver";
  const target = 25;
  const pct = Math.min(100, (jobs / target) * 100);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-8">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Rewards</h1>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-accent)]"><Award className="h-6 w-6 text-primary" /></div>
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">Current level</p>
              <p className="text-[22px] font-bold text-foreground">{level}</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-[color:var(--text-secondary)]">
              <span>{jobs} / {target} jobs to {nextLevel}</span>
              <span className="text-primary">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[color:var(--color-divider)]">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 px-6">
        <h2 className="text-[16px] font-bold text-foreground">Perks</h2>
        <ul className="mt-3 space-y-3">
          {[
            { Icon: Star, title: "Priority bookings", desc: "Silver+ experts get first pick." },
            { Icon: Zap, title: "Faster payouts", desc: "Gold+ experts unlock 3-day payout cycles." },
            { Icon: Gift, title: "Milestone bonuses", desc: "₹500 on hitting 50 jobs." },
          ].map(({ Icon, title, desc }) => (
            <li key={title} className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]"><Icon className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-[15px] font-bold text-foreground">{title}</p>
                <p className="text-[13px] text-[color:var(--text-secondary)]">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-[12px] text-[color:var(--text-secondary)]">Rewards program coming soon.</p>
      </section>
    </div>
  );
}
