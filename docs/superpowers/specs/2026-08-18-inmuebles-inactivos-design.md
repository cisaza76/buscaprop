# Inmuebles inactivos — diseño

Fecha: 2026-08-18
Estado: **implementado 2026-09-08** — ver notas de implementación al final

## Problema

La plataforma no tiene el concepto de "inmueble que ya no está disponible" en la superficie que el usuario ve. `searchProperties` filtra únicamente por `is_duplicate`; nunca consulta `property_history`. Un inmueble retirado del portal le sale al usuario exactamente igual que uno vivo.

Evidencia medida (2026-08-18):

- **Muestra estratificada de 40 fichas de Ciencuadras** (5 ciudades × 4 tipos × 2 operaciones): **16 no están activas**.
  - 6 → el blob `detail-state` responde `{error: true, message: "Property Code without results"}` sin `generalData`. Ficha borrada.
  - 10 → traen `generalData` completo pero `message: "Inmueble No Activo. StatusCode: 1|2"`.
- **22.985 propiedades (8,8%)** llevan más de 90 días sin ser vistas por ningún scraper. Todas buscables.

El caso "Inmueble No Activo" es el más pernicioso: **parsea como item válido con precio y teléfono**, así que se upsertea, refresca su `scraped_at`, y el barrido de staleness —que dispara por antigüedad— nunca lo alcanza. Se auto-refresca para siempre.

## Decisión: columna `is_active` en `properties`

Alternativas descartadas:

- **Búsqueda contra la vista `property_latest_snapshot`** (existe desde la migración 008). Cero columnas nuevas, pero mete un join en la ruta más caliente y PostgREST con vistas se pone incómodo. Conceptualmente más limpio, operacionalmente peor.
- **Sólo cerrar el hueco del parser** (que "No Activo" devuelva `null`). Media hora de trabajo, arregla la mentira de `scraped_at`, pero el inmueble muerto le sigue saliendo al usuario. Paso intermedio, no solución.

`is_active` gana porque es un solo predicado en el hot path, con el mismo patrón que `is_duplicate` —que ya existe, ya está indexado y todo el equipo entiende—, y porque deja el histórico en `property_history`, que es donde va el rastro de auditoría.

**El detalle sigue accesible por link directo.** No es preferencia: es la convención que el código ya fijó, documentada en `markDelistedForPortal` — *"la fila se queda como estaba para que sigamos pudiendo mostrar el detalle si alguien tiene el link"*. Un 404 rompería links compartidos y conversaciones ya existentes. El filtro va en la búsqueda, no en la ficha.

## Esquema

Migración `020_properties_is_active.sql`:

```sql
alter table public.properties
  add column if not exists is_active boolean not null default true;

-- Índice parcial sobre el predicado real de búsqueda.
create index if not exists idx_properties_search_live
  on public.properties (city, listing_type, property_type)
  where is_duplicate = false and is_active;

notify pgrst, 'reload schema';
```

`default true` es deliberado: cualquier fila que no sepamos evaluar se considera viva. El sistema falla hacia "mostrar de más", nunca hacia "esconder el catálogo".

No se agregan `inactive_reason` ni `inactive_at`: duplicarían lo que `property_history` ya registra (`status` + `scraped_at`).

## Caminos de escritura

1. **Señal directa del portal (Ciencuadras).** El parser lee `message` del blob `detail-state` —que `parseCiencuadrasDetailState` ya parsea desde el PR #10— y marca `is_active: false` cuando coincide con `/No Activo/i`. Costo incremental de scraping: cero.
2. **Ficha borrada.** `parseCiencuadrasListing` ya devuelve `null` (no hay precio). Cae al barrido de staleness.
3. **Barrido de staleness.** `markDelistedForPortal` pasa a poner `is_active = false` además de escribir el snapshot `delisted`. Umbral 90 días (ya corregido en el PR #11).
4. **Reactivación.** El upsert escribe `row.is_active = p.is_active ?? true` en cada pasada. El `?? true` es lo que implementa la reactivación y es seguro: que un inmueble llegue al upsert significa que el portal lo sirvió en esta corrida. Los portales sin señal propia (Fincaraiz, M2, Properati) caen siempre en `true`, que es correcto por la misma razón — y no pisa el trabajo del barrido, porque el barrido sólo marca lo que **no** se está viendo. Sin este `?? true`, un falso negativo sería permanente.

`ScrapedProperty` gana `is_active?: boolean`. En `upsertProperty` se trata como columna opcional (`available.has('is_active')`), igual que `contact_phone` — patrón ya establecido, y confiable desde que el PR #11 arregló la detección.

### Corrección necesaria en el barrido

El query de staleness de `markDelistedForPortal` trae `.select('id, price_cop')` sin paginar: PostgREST corta en 1000 filas **sin avisar**. Con 22.985 filas elegibles, procesa 1000 por run y el resto queda invisible. Al volverse camino de escritura de `is_active` hay que paginarlo con `.range()` y loguear el total procesado.

## Caminos de lectura

Seis sitios consultan `properties` con `is_duplicate = false`. Cinco suman `is_active`:

| Sitio | ¿Filtra? | Por qué |
|---|---|---|
| `lib/supabase.ts` · `searchProperties` | **sí** | la búsqueda del usuario |
| `lib/supabase.ts` · `fetchNeighborhoodsByCity` | **sí** | evita barrios fantasma de inventario muerto |
| `lib/ai/analytics.ts` (2 queries) | **sí** | inmuebles muertos sesgan las estadísticas de mercado |
| `lib/ai/zone-alternatives.ts` | **sí** | sugiere zonas por inventario disponible |
| `lib/supabase.ts` · `fetchPropertyById` | **no** | la ficha debe seguir sirviendo por link directo |
| `lib/scrapers/shared/upsert.ts` | **no** | la deduplicación debe considerar todas las filas |

`fetchPropertyById` devuelve `is_active` en el `Property` para que la UI pueda actuar.

## UI

`app/property/[id]/page.tsx` muestra un aviso cuando `is_active === false`: el inmueble ya no está publicado en el portal de origen, con la fecha de la última vez que se vio. Sin aviso, servir la ficha sería engañoso.

## Backfill

Script puntual: `is_active = false` donde `scraped_at < now() - 90 días` → 22.985 filas (8,8% del inventario). Son propiedades que no aparecieron en un ciclo completo de crawling.

Se elige 90 y no menos porque la cadencia real de revisita lo exige: 88% del inventario lleva >7d, 61% >30d, 33% >60d. Un umbral más agresivo escondería catálogo vivo.

## Riesgo y despliegue

El modo de fallo que importa es esconder inventario bueno. Mitigaciones:

- `default true` — sólo se esconde lo que marcamos explícitamente.
- Backfill conservador a 90 días.
- **Medir el conteo de resultados de búsqueda antes y después del backfill.** Caída esperada ≈ 8,8%. Una caída materialmente mayor significa que algo está mal y se revierte con un `update` (la columna es reversible; no se borra nada).

## Fuera de alcance

- **Señales de inactividad de Fincaraiz, Metrocuadrado y Properati.** Cada portal la expresa distinto y cada uno necesita su propia investigación. Quedan cubiertos por el barrido de staleness, que ahora sí corre.
- Cambios en el ranking o el orden de resultados.

## Pruebas

- Unidad pura para el clasificador de actividad de Ciencuadras (`message` → `is_active`), con los tres casos reales medidos: `message: null` → activo; `"Inmueble No Activo. StatusCode: 1"` y `"...StatusCode: 2"` → inactivo (no distinguimos entre los dos códigos: ninguno está disponible); `"Property Code without results"` → sin datos, el parser ya devuelve `null`.
- Caso trampa medido: `error: true` aparece **también** en fichas perfectamente vivas (viene de una sub-request lateral del portal). El clasificador debe mirar `message`, nunca `error`. Test explícito para esto.
- Regresión sobre el fixture real: un inmueble activo mantiene `is_active !== false`.
- Los tests existentes de parser deben seguir verdes (el campo es aditivo).


---

## Notas de implementación (2026-09-08)

Lo que se desvió del diseño, y por qué:

- **La migración es la `021`, no la `020`.** El número 020 se usó ese mismo día
  para `scraper_cursor.active` (baja de Properati, PR #18).
- **El barrido re-afirma `is_active` con un UPDATE en lote** condicionado a
  `is_active = true`, en vez de fila por fila. El conteo que devuelve
  (`markedInactive`) refleja transiciones reales, no re-escrituras.
- **El backfill es un script con dry-run por defecto**
  (`scripts/backfill-is-active.ts`), no un UPDATE suelto. Trae el guardarraíl
  que pedía la sección de riesgo: mide el visible antes/después y **aborta** si
  fuera a marcar más del 25% del inventario, contra el ~8,8% esperado. Esconder
  catálogo vivo es el modo de fallo que importa, y un abort sale más barato que
  un rollback.
- **Errores de PostgREST con `head: true` llegan con `message` vacío.** Un
  `throw` con mensaje en blanco es indiagnosticable, así que el script formatea
  el status y nombra al sospechoso (la columna sin migrar).

Sigue fuera de alcance, tal como el diseño lo dejó: señales de inactividad
propias de Fincaraíz y MetroCuadrado. Quedan cubiertos por el barrido de
staleness a 90 días.
