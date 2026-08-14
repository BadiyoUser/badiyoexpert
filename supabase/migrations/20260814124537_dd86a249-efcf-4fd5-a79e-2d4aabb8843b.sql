CREATE OR REPLACE FUNCTION public.expert_request_skill(_service_category_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expert_id uuid;
  _id uuid;
BEGIN
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN
    RAISE EXCEPTION 'Not an expert';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.service_categories WHERE id = _service_category_id AND is_active) THEN
    RAISE EXCEPTION 'Invalid service category';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partner_skills
    WHERE expert_id = _expert_id AND service_category_id = _service_category_id
  ) THEN
    RAISE EXCEPTION 'Skill already requested';
  END IF;

  INSERT INTO public.partner_skills (expert_id, service_category_id, status)
  VALUES (_expert_id, _service_category_id, 'pending')
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.expert_request_skill(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expert_request_skill(uuid) TO authenticated;