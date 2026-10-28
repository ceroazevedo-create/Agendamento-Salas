
DO $migration$
DECLARE
  v_function_def TEXT;
  v_old TEXT := $old$'period_name', COALESCE(p_period_name, ''),$old$;
  v_new TEXT := $new$'period_name', COALESCE(p_period_shift, ''),
    'display_period_name', COALESCE(NULLIF(trim(p_period_name), ''), ''),$new$;
BEGIN
  v_function_def := pg_get_functiondef(
    'public.create_recurring_series(text,uuid,uuid,text,integer,integer,text,text,text,date[],boolean,text,text)'
    ::regprocedure
  );

  IF position(v_new IN v_function_def) > 0 THEN
    RAISE NOTICE 'Correção de idempotência já aplicada.';
    RETURN;
  END IF;

  IF (
    length(v_function_def)
    - length(replace(v_function_def, v_old, ''))
  ) / length(v_old) <> 1 THEN
    RAISE EXCEPTION
      'Migração cancelada: o trecho esperado não foi encontrado exatamente uma vez.';
  END IF;

  v_function_def := replace(v_function_def, v_old, v_new);
  EXECUTE v_function_def;
END;
$migration$;

