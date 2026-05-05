// lib/cadastre/ideca.ts
// Cliente para Esri REST API de Catastro Bogotá (IDECA).
//   serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia
//
// Sin autenticación, sin costo. Datos públicos.
//
// Operación principal: dado (lat, lng) → devuelve datos catastrales del lote.
// Hacemos 4 queries en paralelo (Lote, Manzana, Sector, Suelo) y combinamos.
//
// Layers usados (verificados via probe Phase 10):
//   38 - Lote        (LOTCODIGO, MANZCODIGO, LOTUPREDIA, polygon)
//   40 - Manzana     (MANCODIGO, SECCODIGO)
//   37 - Sector      (SCACODIGO, SCANOMBRE)
//   45 - Suelo       (SUECSUELO, SUEAADMIN)
//
// Limitaciones conocidas:
//   - El operation /identify del MapServer cuelga con timeout. NO usar.
//     Usar /query por layer.
//   - El "CHIP" tradicional de Bogotá no se expone en este servicio. Solo
//     LOTCODIGO (que es el identificador catastral oficial).

const IDECA_BASE =
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer';

const IDECA_UA = 'BuscaProp/1.0 (+contacto@buscaprop.co)';

const TIMEOUT_MS = 15_000;

export interface IDECAQueryResult {
  status: 'verified' | 'not_found' | 'error';
  lot_code: string | null;
  manzana_code: string | null;
  sector_code: string | null;
  sector_name: string | null;
  predio_units: number | null;
  lot_area_m2: number | null;
  soil_classification: number | null;
  soil_admin_act: string | null;
  /** Cuando status='error', detalle del error. */
  error_message?: string;
}

/**
 * Consulta IDECA para enriquecer una propiedad por sus coordenadas.
 * Devuelve siempre un IDECAQueryResult — nunca lanza. Si todo falla,
 * status='error' con error_message.
 */
export async function queryIDECAByCoords(
  lat: number,
  lng: number
): Promise<IDECAQueryResult> {
  // Validación básica.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return errorResult('invalid coords');
  }

  try {
    // 4 queries en paralelo. AbortController para timeout global.
    const [lote, manzana, sector, suelo] = await Promise.all([
      queryLayerAtPoint(38, lat, lng, true), // returnGeometry=true para área
      queryLayerAtPoint(40, lat, lng, false),
      queryLayerAtPoint(37, lat, lng, false),
      queryLayerAtPoint(45, lat, lng, false),
    ]);

    // Si Lote no devolvió nada, las coords están fuera del catastro de Bogotá.
    if (!lote || !lote.attributes) {
      return {
        status: 'not_found',
        lot_code: null,
        manzana_code: null,
        sector_code: null,
        sector_name: null,
        predio_units: null,
        lot_area_m2: null,
        soil_classification: null,
        soil_admin_act: null,
      };
    }

    const lotAttrs = lote.attributes as Record<string, unknown>;
    const manAttrs = (manzana?.attributes ?? {}) as Record<string, unknown>;
    const secAttrs = (sector?.attributes ?? {}) as Record<string, unknown>;
    const suelAttrs = (suelo?.attributes ?? {}) as Record<string, unknown>;

    // Calcular área del lote desde el polígono.
    const area = lote.geometry ? calculatePolygonAreaM2(lote.geometry) : null;

    return {
      status: 'verified',
      lot_code: stringOrNull(lotAttrs.LOTCODIGO),
      manzana_code: stringOrNull(manAttrs.MANCODIGO ?? lotAttrs.MANZCODIGO),
      sector_code: stringOrNull(secAttrs.SCACODIGO ?? manAttrs.SECCODIGO),
      sector_name: stringOrNull(secAttrs.SCANOMBRE),
      predio_units: numberOrNull(lotAttrs.LOTUPREDIA),
      lot_area_m2: area,
      soil_classification: numberOrNull(suelAttrs.SUECSUELO),
      soil_admin_act: stringOrNull(suelAttrs.SUEAADMIN),
    };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// Internal: query single layer at point
// ============================================================================

interface IDECAFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
}

async function queryLayerAtPoint(
  layerId: number,
  lat: number,
  lng: number,
  returnGeometry: boolean
): Promise<IDECAFeature | null> {
  const geom = JSON.stringify({
    x: lng,
    y: lat,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry: geom,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outFields: '*',
    returnGeometry: returnGeometry ? 'true' : 'false',
    outSR: '4326',
    f: 'json',
  });
  const url = `${IDECA_BASE}/${layerId}/query?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': IDECA_UA },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`layer ${layerId}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { features?: IDECAFeature[]; error?: { message?: string } };
    if (data.error) {
      throw new Error(`layer ${layerId}: ${data.error.message ?? 'unknown error'}`);
    }
    const first = data.features?.[0];
    return first ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Geometry: cálculo de área de polígono lat/lng en m²
// ============================================================================
//
// Aproximación local equirectangular. Adecuada para áreas pequeñas (<1 km²)
// como lotes urbanos. Error <0.5% para latitudes ecuatoriales.

function calculatePolygonAreaM2(geom: { rings?: number[][][] }): number | null {
  const rings = geom.rings;
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return null;

  // Tomar el primer ring (outer). Si hay múltiples rings (donut), restamos
  // los inner rings — pero en lotes catastrales es raro, simplificamos.
  const outer = rings[0];
  const inners = rings.slice(1);

  const outerArea = ringAreaM2(outer);
  const innerArea = inners.reduce((s, r) => s + ringAreaM2(r), 0);

  const area = Math.max(0, outerArea - innerArea);
  return Math.round(area * 100) / 100; // 2 decimales
}

function ringAreaM2(ring: number[][]): number {
  // Convertir lat/lng a metros usando proyección equirectangular local.
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mxPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const myPerDegLat = 110540;

  // Shoelace.
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x1 * mxPerDegLng) * (y2 * myPerDegLat) - (x2 * mxPerDegLng) * (y1 * myPerDegLat);
  }
  return Math.abs(sum) / 2;
}

// ============================================================================
// Helpers
// ============================================================================

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return String(v);
}

function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function errorResult(message: string): IDECAQueryResult {
  return {
    status: 'error',
    lot_code: null,
    manzana_code: null,
    sector_code: null,
    sector_name: null,
    predio_units: null,
    lot_area_m2: null,
    soil_classification: null,
    soil_admin_act: null,
    error_message: message,
  };
}

// ============================================================================
// Soil classification helpers (POT codes)
// ============================================================================

const SOIL_LABELS: Record<number, string> = {
  1: 'Urbano',
  2: 'Rural',
  3: 'Expansión urbana',
  4: 'Suburbano',
  5: 'Protección',
};

export function soilClassificationLabel(code: number | null): string | null {
  if (code == null) return null;
  return SOIL_LABELS[code] ?? `Clase ${code}`;
}
