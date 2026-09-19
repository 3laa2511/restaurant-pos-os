CREATE OR REPLACE FUNCTION public.set_order_branch_from_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE v_branch_id UUID; v_user_id UUID;
BEGIN
  IF NEW.entity IN ('orders','Order') AND NEW.entity_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    IF NEW.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_user_id := NEW.user_id::UUID;
      SELECT p.branch_id INTO v_branch_id FROM profiles p WHERE p.user_id=v_user_id;
      IF v_branch_id IS NOT NULL THEN
        UPDATE orders SET branch_id=v_branch_id,updated_at=NOW()
        WHERE id::text=NEW.entity_id AND branch_id IS NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;