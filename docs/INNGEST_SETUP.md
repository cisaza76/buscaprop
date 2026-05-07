# Setup Inngest — pasos manuales

Este doc lista lo que el equipo debe hacer **una sola vez** para activar el
scraping incremental con Inngest. El código ya está commiteado — solo falta
configurar las cuentas y secrets.

## 1. Crear cuenta Inngest (gratis)

1. Ir a https://app.inngest.com/sign-up
2. Sign up con GitHub o email
3. Crear un workspace para `buscaprop`
4. Plan: **Free Tier** (50,000 events/mes — alcanza para nuestro uso de ~49k/mes)

## 2. Conectar Vercel a Inngest

Hay 2 caminos. **Recomendado: Vercel Marketplace integration** (más simple).

### Opción A — Vercel Marketplace (recomendado)

1. Vercel Dashboard → tu proyecto `buscaprop` → **Integrations**
2. Browse Marketplace → buscar **"Inngest"**
3. Click "Install" → autorizar
4. Inngest auto-configura `INNGEST_EVENT_KEY` y `INNGEST_SIGNING_KEY` como
   env vars del proyecto (no tenés que tocar nada más)
5. Vercel hace redeploy automático

### Opción B — Manual (si Marketplace no funciona)

1. En Inngest Cloud → Settings → Event Keys → copiar `INNGEST_EVENT_KEY`
2. En Inngest Cloud → Settings → Signing Keys → copiar `INNGEST_SIGNING_KEY`
3. En Vercel Dashboard → Settings → Environment Variables → agregar las dos
   con scope **Production + Preview + Development**
4. Redeploy desde Vercel UI

## 3. Registrar el endpoint en Inngest

Inngest necesita saber dónde está tu webhook handler.

1. En Inngest Cloud → **Apps** → "New App"
2. URL: `https://<tu-dominio>.vercel.app/api/inngest`
   (cambia `<tu-dominio>` por la URL de producción real)
3. Click "Sync" → Inngest hace un GET al endpoint y descubre las 4 funciones:
   - `scrape-fincaraiz-tick` (cada 30 min)
   - `scrape-ciencuadras-tick` (cada 30 min)
   - `scrape-metrocuadrado-tick` (cada hora)
   - `scrape-properati-tick` (cada hora a la media)

Si la sync falla, verificar que `/api/inngest` responde 200 con `curl`.

## 4. Correr la migración de Supabase

La tabla `scraper_cursor` debe existir antes del primer tick.

1. Ir a Supabase Dashboard → tu proyecto → **SQL Editor**
2. Abrir archivo `supabase/migrations/013_scraper_cursor.sql` del repo
3. Copiar el contenido completo → pegar en SQL Editor → **Run**
4. Verificar: `select * from scraper_cursor;` debe devolver 4 filas (una por portal)

## 5. Verificar el primer tick

Después de la sync, esperar ~30 min y verificar:

1. **Inngest Cloud → Runs**: deberían empezar a aparecer ejecuciones de las 4 funciones
2. **Supabase → scraper_cursor table**: las columnas `last_run_at`, `last_run_status`,
   `total_upserted` deberían empezar a cambiar
3. **Supabase → properties table**: count debería ir creciendo

Para forzar un tick inmediato (sin esperar al cron):

1. Inngest Cloud → Functions → `scrape-fincaraiz-tick`
2. Click "Invoke" → "Send test event" (deja el event vacío, no lo necesita)
3. Run debería completar en ~3 minutos

## Cuotas y costos esperados

| Recurso | Free tier | Uso esperado | Margen |
|---|---|---|---|
| Inngest events | 50,000/mes | ~49,000/mes | 2% |
| Inngest steps | 200,000/mes | ~150,000/mes | 25% |
| Vercel function invocations | 100k/mes (Hobby), 1M (Pro) | ~50,000/mes | OK Hobby, holgado Pro |
| Vercel function compute | 100 GB-h (Hobby), 1000 (Pro) | ~150 GB-h/mes | **Pro requerido** |
| Supabase DB size | 500MB (Free), 8GB (Pro) | ~200MB inicial → 800MB en 6 meses | **Pro requerido** ~mes 4 |

**Recomendación**: si vamos a llegar a 100k+ propiedades, presupuestar
**Vercel Pro ($20/mes) + Supabase Pro ($25/mes) = $45/mes** total operativo.

## Troubleshooting

### Las funciones aparecen en Inngest pero no se ejecutan

Verificar:
- `INNGEST_SIGNING_KEY` está en Vercel env vars
- El endpoint `/api/inngest` responde 200 (probar con curl)
- En Inngest Cloud → App settings → "Sync app" para forzar re-discovery

### Las funciones se ejecutan pero `total_upserted` no crece

- Probable: error en el scraper. Ver Inngest Cloud → Runs → click en el run
  fallido → "Step output" → busca el error en el step `scrape`
- Verificar que las env vars de Supabase están en Vercel (`NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`)

### Vercel function timeout (300s) en cada tick

- Bajar `TICK_MAX` en `lib/inngest/functions.ts` de 150 a 100 o 80
- El cursor garantiza que no perdemos progreso — solo hace runs más cortos
