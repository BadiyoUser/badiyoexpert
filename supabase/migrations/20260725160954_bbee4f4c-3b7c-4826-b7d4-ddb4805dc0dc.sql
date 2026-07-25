
-- Storage RLS: users can manage files only under expert-avatars/{auth.uid()}/*
CREATE POLICY "Experts read own avatars"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'expert-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Experts upload own avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expert-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Experts update own avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'expert-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Experts delete own avatars"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'expert-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Expert-owned photo_url update (bypasses experts write-restrictions safely)
CREATE OR REPLACE FUNCTION public.expert_update_photo_url(_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _expert_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _expert_id FROM public.experts WHERE auth_user_id = _uid LIMIT 1;
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;
  IF _url IS NOT NULL AND length(_url) > 2000 THEN RAISE EXCEPTION 'URL too long'; END IF;
  UPDATE public.experts SET photo_url = NULLIF(btrim(_url), '') WHERE id = _expert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.expert_update_photo_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expert_update_photo_url(text) TO authenticated;
