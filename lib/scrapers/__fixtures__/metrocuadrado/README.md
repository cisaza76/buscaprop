# MetroCuadrado fixtures

Snapshots de HTML capturados durante recon Día 2 (2026-05-04) para tests
offline en Día 3. Permiten desarrollar el parser sin pegar al servidor de
M2 cada vez.

## Detail pages

| Archivo | URL fuente | Notas |
|---|---|---|
| `detail-rosales-venta.html` | `/inmueble/venta-apartamento-bogota-los-rosales-3-habitaciones-3-banos-2-garajes/20690-M6621558` | Apartamento usado, Bogotá, $1.2B, 150m², 3hab/3baños/2garajes |
| `detail-toberin-venta.html` | `/inmueble/venta-apartamento-bogota-toberin-3-habitaciones-2-banos-1-garajes/MC6627253` | Apartamento, Toberín, 3hab/2baños/1garaje |

Estructura RSC: 12 chunks, chunk[7] contiene `data.{...}` con todos los
campos (price, area, rooms, bathrooms, neighborhood, coordinates, comment,
images, etc).

## Search pages

| Archivo | URL fuente | Listings |
|---|---|---|
| `search-apto-venta-bogota.html` | `/apartamento/venta/bogota/` | 68 listings (mix /inmueble/ + /proyecto/) |
| `search-casa-venta-bogota.html` | `/casa/venta/bogota/` | 68 listings |

Estructura RSC: ~25 chunks, chunk[18] contiene `"results":[...]` con cada
item teniendo midinmueble, link, title, mvalorventa/arriendo, mtipoinmueble,
marea, mnrocuartos, mnrobanos, mciudad, mbarrio, etc.

## Limitaciones conocidas

1. **Sin paginación viable**: probado `?page=2`, `?_offset=`, `/2/` — ninguno
   devuelve resultados nuevos. Pagination = scroll-infinito vía API AWS.
2. **Search page NO trae coords ni description**. Requiere detail-fetch para
   esos campos (opcional, costoso).
3. Cada chunk RSC usa escapes JS (`\"`, `\\`, `\n`); decodificar con
   `JSON.parse('"' + chunk + '"')` antes de buscar campos.
