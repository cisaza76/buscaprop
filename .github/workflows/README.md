# Scheduler de scrapers (GitHub Actions)

`scrape-cron.yml` corre los 4 scrapers cada 6h en un runner de GitHub.

## Por qué NO vía webhook a Vercel

El plan inicial del Día 1 era apuntar el cron a `/api/cron/scrape`. **No
funciona** con la arquitectura actual porque:

| Plan Vercel | Timeout máx |
|---|---|
| Hobby | 60s |
| Pro | 300s (default) — 800s (Edge config) |

Pero el run completo de los scrapers (4 portales × promedio 200 props c/u)
tarda **30–60 min**. Ciencuadras solo, a `--max 1000`, tarda 100 min.

Cualquier API route timeout → request abortada → DB queda parcialmente
poblada. La forma "correcta" de hacerlo en Vercel sería partir cada portal
en jobs incrementales de <300s y orquestar 50+ invocaciones, lo cual es
ingeniería innecesaria cuando GitHub Actions ya tiene **6 horas de
runtime gratis** por job.

El endpoint `/api/cron/scrape` queda en el código por si lo querés usar
para trigger manual con runs muy pequeños (`--max 5`) desde otro workflow.

## Setup — secrets que necesitás agregar

Andá a **github.com/cisaza76/buscaprop → Settings → Secrets and variables
→ Actions → New repository secret** y agregá los 3 valores que están en
tu `.env.local`:

| Nombre | Valor (de `.env.local`) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://fjzyuxabvmeyqjehzceb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | el `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | el JWT largo que empieza con `eyJ...` |

> **No agregues `CRON_SECRET`** — no lo usamos en este workflow porque no
> hace webhook. Si después armás el flujo webhook como herramienta
> auxiliar, ese sí lo necesita.

## Test manual

Una vez los secrets están en GitHub:

```bash
# Trigger del workflow completo (todos los portales, max 200 c/u)
gh workflow run scrape-cron.yml

# O con parámetros (solo Properati arriendo, 50 listings):
gh workflow run scrape-cron.yml \
  -f portal=properati \
  -f op=arriendo \
  -f max=50

# Ver runs recientes
gh run list --workflow=scrape-cron.yml --limit 5

# Ver logs del último run
gh run view --log-failed
```

También podés disparar manualmente desde la UI: **Actions → Scrape
portales → Run workflow** (selecciona portal/op/max desde un form).

## Scheduled runs

```cron
0 */6 * * *
```

Corre a las **00:00, 06:00, 12:00, 18:00 UTC** = **19:00, 01:00, 07:00,
13:00 hora Colombia**.

Default por run: `--max 200` (sin filtros) → ~800 props nuevas/refresh
cada 6h. ~3,200 props/día actualizadas.

**Reglas de concurrencia**: si una corrida sigue activa cuando llega la
siguiente, esta última se encola (no se cancela la activa). Si necesitás
matar una corrida atascada: `gh run cancel <run-id>`.

## Tweaks sugeridos para producción

Cuando ya tengamos volumen estable y queramos optimizar costos:

1. **Bajar frecuencia a cada 12h** (`0 */12 * * *`): nuevos listings no
   aparecen tan rápido como para justificar 6h. Reduce a la mitad el
   uso de minutos de Actions (irrelevante en free tier, importante si
   pagamos).

2. **Split por portal** en jobs paralelos: matrix strategy con
   `portal: [fincaraiz, metrocuadrado, properati, ciencuadras]` reduce
   wall-time de 60min a ~25min (limitado por Ciencuadras).

3. **Usar GitHub Actions cache** para `node_modules` ya está activado
   (`cache: 'npm'`). Para ir más allá, cachear las páginas de sitemap
   y solo refetch las que cambiaron `<lastmod>`.

4. **Notificación a Slack/Discord** en falla: agregar step con
   `if: failure()` que postee a un webhook.

5. **Activar deduplicación cross-portal**: correr la migración
   `supabase/migrations/003_add_dedup_hash.sql` en Supabase (1 ALTER
   TABLE). Después de eso, los siguientes runs van a marcar
   `is_duplicate=true` cuando una propiedad aparezca en múltiples
   portales. El UI ya filtra `is_duplicate=false` por default.
