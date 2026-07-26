CREATE OR REPLACE FUNCTION public.has_login_pin(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  _exists boolean := false;
BEGIN
  IF _digits = '' THEN RETURN false; END IF;

  -- Check experts first (this app is for experts)
  SELECT EXISTS(
    SELECT 1 FROM public.experts e
    WHERE regexp_replace(coalesce(e.phone,''), '\D', '', 'g') LIKE '%' || _digits
      AND e.pin_hash IS NOT NULL
  ) INTO _exists;

  IF _exists THEN RETURN true; END IF;

  -- Fallback to users (customer app)
  SELECT EXISTS(
    SELECT 1 FROM public.users u
    WHERE regexp_replace(coalesce(u.phone,''), '\D', '', 'g') LIKE '%' || _digits
      AND u.pin_hash IS NOT NULL
  ) INTO _exists;

  RETURN _exists;
END;
$function$;