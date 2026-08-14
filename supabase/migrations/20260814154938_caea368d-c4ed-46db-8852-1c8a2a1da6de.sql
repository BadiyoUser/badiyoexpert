DROP POLICY IF EXISTS "Authenticated can read dispatch config" ON public.dispatch_config;

CREATE POLICY "Staff can read dispatch config"
ON public.dispatch_config FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), NULL));

CREATE OR REPLACE FUNCTION public.get_broadcast_radius_km()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT broadcast_radius_km FROM public.dispatch_config LIMIT 1), 5)
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_broadcast_radius_km() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_radius_km() TO authenticated;