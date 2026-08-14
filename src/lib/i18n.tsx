import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Preferences } from "@capacitor/preferences";
import { supabase } from "@/integrations/supabase/client";
import { en } from "./locales/en";
import { mr } from "./locales/mr";

export type Lang = "en" | "mr";
export type TranslationKey = keyof typeof en;

const DICTS: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, mr };
const STORAGE_KEY = "badiyo.expert.lang";
export const DEFAULT_LANG: Lang = "en";

function isLang(v: unknown): v is Lang {
  return v === "en" || v === "mr";
}

type Ctx = {
  lang: Lang;
  ready: boolean;
  setLang: (lang: Lang) => Promise<void>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const [ready, setReady] = useState(false);

  // 1) instant: cached choice  2) authoritative: experts.preferred_language
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cached = await Preferences.get({ key: STORAGE_KEY });
        if (mounted && isLang(cached.value)) setLangState(cached.value);
      } catch {
        /* ignore */
      }
      if (mounted) setReady(true);
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (!uid) return;
        const { data: row } = await supabase
          .from("experts")
          .select("preferred_language")
          .eq("auth_user_id", uid)
          .maybeSingle();
        const remote = row?.preferred_language;
        if (mounted && isLang(remote)) {
          setLangState(remote);
          void Preferences.set({ key: STORAGE_KEY, value: remote });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setLang = useCallback(async (next: Lang) => {
    setLangState(next);
    try {
      await Preferences.set({ key: STORAGE_KEY, value: next });
    } catch {
      /* ignore */
    }
    const { error } = await supabase.rpc("expert_set_language", { _lang: next });
    if (error) throw error;
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let out = DICTS[lang]?.[key] ?? en[key] ?? (key as string);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, ready, setLang, t }), [lang, ready, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Safe fallback so a component outside the provider never crashes.
    return {
      lang: DEFAULT_LANG,
      ready: true,
      setLang: async () => {},
      t: (key) => en[key] ?? (key as string),
    };
  }
  return ctx;
}

export function useT() {
  return useLanguage().t;
}
