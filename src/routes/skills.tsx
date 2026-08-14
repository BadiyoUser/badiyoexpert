import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Plus, CheckCircle2, Clock, XCircle, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession } from "@/lib/expert-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/skills")({
  head: () => ({
    meta: [
      { title: "My Skills — Badiyo Expert" },
      { name: "description", content: "View your approved skills and request new service categories." },
    ],
  }),
  component: SkillsScreen,
});

type SkillRow = {
  id: string;
  status: string;
  created_at: string;
  service_category_id: string;
  service_categories: { id: string; name: string } | null;
};

function useSkills(expertId: string | null | undefined) {
  return useQuery({
    queryKey: ["partner-skills", expertId],
    enabled: !!expertId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_skills")
        .select("id, status, created_at, service_category_id, service_categories(id, name)")
        .eq("expert_id", expertId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SkillRow[];
    },
  });
}

function useCategories() {
  return useQuery({
    queryKey: ["service-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_categories")
        .select("id, name, rank")
        .eq("is_active", true)
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const GROUPS = [
  { key: "approved", label: "Approved", Icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700" },
  { key: "pending", label: "Pending review", Icon: Clock, cls: "bg-amber-100 text-amber-700" },
  { key: "rejected", label: "Rejected", Icon: XCircle, cls: "bg-red-100 text-red-700" },
] as const;

function SkillsScreen() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);

  const skills = useSkills(expert?.id);
  const categories = useCategories();

  const requestSkill = useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await supabase.rpc("expert_request_skill", {
        _service_category_id: categoryId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Skill requested — pending review");
      setPicking(false);
      await qc.invalidateQueries({ queryKey: ["partner-skills", expert?.id] });
    },
    onError: (e) => toast.error((e as Error).message ?? "Could not request skill"),
  });

  const owned = new Set((skills.data ?? []).map((s) => s.service_category_id));
  const available = (categories.data ?? []).filter((c) => !owned.has(c.id));

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/profile" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">My Skills</h1>
      </header>

      <p className="px-6 text-[13px] leading-snug text-[color:var(--text-secondary)]">
        You only receive jobs for skills that have been approved by the Badiyo team.
      </p>

      <div className="mt-5 flex-1 space-y-6 px-6">
        {skills.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (skills.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center rounded-[18px] border border-border bg-card p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
              <Wrench className="h-7 w-7 text-primary" />
            </div>
            <p className="mt-4 text-[16px] font-bold text-foreground">No skills yet</p>
            <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
              Request a skill below to start receiving jobs.
            </p>
          </div>
        ) : (
          GROUPS.map(({ key, label, Icon, cls }) => {
            const rows = (skills.data ?? []).filter((s) => s.status === key);
            if (rows.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
                  {label}
                </h2>
                <div className="space-y-2">
                  {rows.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <p className="flex-1 text-[15px] font-semibold text-foreground">
                        {s.service_categories?.name ?? "Service"}
                      </p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`}>
                        {label.split(" ")[0].toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}

        {picking && (
          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
              Available skills
            </h2>
            {available.length === 0 ? (
              <p className="rounded-[14px] border border-border bg-card p-4 text-[13px] text-[color:var(--text-secondary)]">
                You've already requested every available skill.
              </p>
            ) : (
              <div className="space-y-2">
                {available.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={requestSkill.isPending}
                    onClick={() => requestSkill.mutate(c.id)}
                    className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-card p-4 text-left disabled:opacity-60"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
                      <Plus className="h-5 w-5 text-primary" />
                    </div>
                    <p className="flex-1 text-[15px] font-semibold text-foreground">{c.name}</p>
                    {requestSkill.isPending && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="px-6 pt-8">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-white"
        >
          {picking ? "Close" : (<><Plus className="h-5 w-5" /> Request a new skill</>)}
        </button>
      </div>
    </div>
  );
}
