# Scraping Roadmap — Hacia 100% del Inventario

Estado a 2026-05-06. Objetivo: cobertura cercana al 100% del inventario público en
los 4 portales (MetroCuadrado, Fincaraíz, Ciencuadras, Properati).

## Estado actual (Fase 1 — implementada)

| Portal | Discovery | Limit/run | Cobertura aprox |
|---|---|---|---|
| **MetroCuadrado** | City+barrio (12 barrios premium Bogotá) | 5000 | ~10% (por falta de paginación API) |
| **Fincaraíz** | Sitemap completo | 1500/run | ~5% (sitemap tiene ~150k+ URLs Colombia) |
| **Ciencuadras** | Sitemap completo | 1500/run | ~5% (sitemap tiene 100k+ URLs) |
| **Properati** | Search-based | Estado actual | Variable |

**Configuración del cron** (`app/api/cron/scrape/route.ts`):
- Acepta `?portal=X` para correr 1 portal por invocación
- Acepta `?max=N` para override del limit
- `maxDuration = 800s` (Vercel Pro)

**Recomendación operativa con Fase 1**:
- 4 cron jobs separados (1 por portal), cada uno cada hora
- GitHub Actions es ideal: gratis, sin timeout
- Vercel Cron (Pro): cabe pero con margen ajustado

## Fase 2 — Worker Queue + Cobertura ampliada

### Objetivo
Capturar 70-85% del inventario, con scraping continuo en background sin
timeout limits.

### Stack propuesto
- **Inngest** (gratis hasta 50k events/mes, nativo Vercel) o
- **Trigger.dev** (gratis hasta 10k jobs/mes)

### Cambios técnicos
1. Mover los scrapers a Inngest functions con timeout de 1h
2. Cada función procesa N URLs y persiste cursor en DB
3. Próxima invocación continúa desde el cursor (offset paginated)
4. Múltiples workers en paralelo por portal (cada uno con sub-rango)

### Tareas concretas

- [ ] Setup Inngest en el proyecto (`@inngest/sdk` + `app/api/inngest/route.ts`)
- [ ] Tabla `scraper_cursor` en Supabase: `{portal, last_sitemap_idx, last_url_idx, updated_at}`
- [ ] Refactor `scrapeFincaraiz` para aceptar `cursor` y devolver `nextCursor`
- [ ] Refactor `scrapeCiencuadras` igual
- [ ] Refactor `scrapeMetroCuadrado` para procesar N combos por run
- [ ] Inngest function `scrape.tick` que dispara cada 5 min, lee cursor, procesa 200 URLs, actualiza cursor
- [ ] Dashboard simple en `/dashboard/scraping` con stats por portal

### Investigación necesaria

#### Properati (pendiente)
- robots.txt → 403 forbidden
- Probar User-Agent rotation
- Probar headers de browser real (Accept-Language, Sec-Fetch-*)
- Si bloquea consistentemente: usar **playwright headless** con browser real
  (último recurso, costoso)

#### MetroCuadrado API AWS
- Endpoint identificado: `qbx5rofzo3.execute-api.us-east-2.amazonaws.com`
- Reverse-engineer: capturar payload del POST que pagina (DevTools → Network)
- Probable estructura: `POST /search { from: 0, size: 50, filters: {...} }`
- Si funciona: paginación real → 100% de M2 con ~200 requests por combo

### Tiempo estimado: 10-15 horas de desarrollo

## Fase 3 — Cluster + Refresh diario

### Objetivo
95%+ del inventario refrescado cada 24h. Scraping incremental basado en
`lastmod` de sitemaps (solo URLs cambiadas desde último run).

### Cambios técnicos
1. **Scraping incremental**: cada portal mantiene `last_run_at`. Solo procesar
   URLs con `lastmod > last_run_at` o nuevas (no en DB).
2. **Multiple regions**: ejecutar workers desde diferentes regiones AWS para
   evitar rate limiting por IP
3. **Proxy rotation** (opcional, $$$): si los portales empiezan a banear
   nuestras IPs, rotar via Bright Data o similar
4. **Dead letter queue** para URLs que fallan repetidamente
5. **Alerts** si la tasa de scraping cae

### Tareas concretas

- [ ] Tabla `property_seen` con `(source_url, last_seen_at)` — sweep para
      marcar como `delisted` lo que no aparece en >7 días
- [ ] Lastmod tracking por sub-sitemap
- [ ] Métricas en `/api/admin/scraping-stats`
- [ ] Healthcheck visual: gráfico de listings/portal/día
- [ ] Rate limiter por portal (evita 429s)

### Riesgos / costos a monitorear

| Recurso | Free tier | Pro/$$ |
|---|---|---|
| Vercel | 10s cron | 800s ($20/mes) |
| Supabase | 500MB DB | 8GB ($25/mes) |
| Inngest | 50k events/mes | 200k+ ($20/mes) |
| Bright Data proxy (si aplica) | — | ~$500/mes |

**Threshold crítico**: a ~100k propiedades, Supabase free se quedará corto.
Migrar a Pro cuando lleguemos a 80k.

### Tiempo estimado: 25-40 horas de desarrollo

## KPIs por fase

| Métrica | Hoy | Post-Fase 1 | Post-Fase 2 | Post-Fase 3 |
|---|---|---|---|---|
| Propiedades totales | ~700 | ~10k | ~80k | ~300k |
| Cobertura % | ~5% | ~30% | ~70% | ~95% |
| Refresh frequency | 6h | 1h | 5 min | 24h diff |
| Bogotá Rosales arriendo | 65 | 65 | ~150 | ~400 |

## Notas finales

- El "100% literal" puede ser inalcanzable — los portales mismos no garantizan
  100% de uptime y los listings cambian segundo a segundo. Target realista:
  **95% del inventario activo, refrescado en últimas 24h**.
- Si un portal nos detecta scrapeando agresivo, podemos quedarnos sin acceso.
  Por eso Fase 2/3 incluye rate limiting + rotation.
- Considerar contactar a los portales para acuerdo formal de data sharing
  (algunos ofrecen APIs paid, ej: Inmuebles24 en otros países).
