
DO $migration$
DECLARE
  v_function_def TEXT;
  v_old TEXT := $old$'period_name', COALESCE(v_period_code, ''),$old$;
  v_new TEXT := $new$'period_name', COALESCE(v_period_code, ''),
    'display_period_name', COALESCE(NULLIF(trim(p_period_name), ''), ''),$new$;
  v_old_count INTEGER;
  v_new_count INTEGER;
BEGIN
  v_function_def := pg_get_functiondef(
    'public.create_recurring_series(text,uuid,uuid,text,integer,integer,text,text,text,date[],boolean,text,text)'
    ::regprocedure
  );

  v_old_count :=
    (
      length(v_function_def)
      - length(replace(v_function_def, v_old, ''))
    ) / length(v_old);

  v_new_count :=
    (
      length(v_function_def)
      - length(replace(v_function_def, v_new, ''))
    ) / length(v_new);

  IF v_new_count = 1 THEN
    RAISE NOTICE 'Correção de idempotência já aplicada.';
    RETURN;
  END IF;

  IF v_old_count <> 1 THEN
    RAISE EXCEPTION
      'Migração cancelada: esperado encontrar 1 trecho antigo, encontrados %.',
      v_old_count;
  END IF;

  v_function_def := replace(v_function_def, v_old, v_new);
  EXECUTE v_function_def;

  RAISE NOTICE 'Hash de idempotência atualizado com display_period_name.';
END;
$migration$;
