-- 020_scraper_cursor_active.sql
-- Permite dar de baja un portal como fuente activa sin borrar su cursor ni
-- meter listas de excepciones en el código.
--
-- Contexto (Properati, 2026-09-08): el portal responde 401 al 100% de los
-- requests desde el 26-ago. El diagnóstico del 07-sep
-- (.github/workflows/diag-properati-headless.yml) confirmó que bloquea por
-- fingerprint del modo headless de Chromium, no por IP. La vía técnica que
-- queda —Playwright headed vía xvfb— se evaluó y se descartó: es sostener
-- infraestructura de navegador contra el WAF de un tercero que ya señaló que
-- no quiere acceso automatizado (robots.txt en 403), por el 8% del inventario.
--
-- Por qué una columna y no borrar la fila ni filtrar por nombre en el código:
-- check-scraper-health.ts enumera portales leyendo esta tabla justamente para
-- no tener listas hardcodeadas. Una excepción por nombre dentro del checker es
-- la semilla del próximo falso verde (ver incidentes PGRST125 y properati-401).
-- Con la columna, un portal inactivo simplemente no se audita, y volver a
-- activarlo es un UPDATE — el cursor y las métricas acumuladas siguen ahí.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

alter table public.scraper_cursor
  add column if not exists active boolean not null default true;

comment on column public.scraper_cursor.active is
  'false = portal dado de baja: no se scrapea ni se audita en check-scraper-health. El cursor se conserva para poder reactivarlo.';

-- Dar de baja Properati (idempotente).
update public.scraper_cursor
   set active = false,
       last_run_message = 'dado de baja 2026-09-08: bloqueo 401 por fingerprint headless; ver migración 020'
 where portal = 'properati';
