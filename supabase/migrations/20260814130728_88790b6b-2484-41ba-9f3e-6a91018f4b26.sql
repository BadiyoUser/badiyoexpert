ALTER TABLE public.experts ALTER COLUMN preferred_language SET DEFAULT 'en';

CREATE OR REPLACE FUNCTION public.expert_set_language(_lang text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expert_id uuid;
BEGIN
  IF _lang NOT IN ('en','mr') THEN
    RAISE EXCEPTION 'Unsupported language: %', _lang;
  END IF;

  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN
    RAISE EXCEPTION 'Not an expert';
  END IF;

  UPDATE public.experts
     SET preferred_language = _lang
   WHERE id = _expert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.expert_set_language(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expert_set_language(text) TO authenticated, service_role;