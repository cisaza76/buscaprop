// scripts/smoke-coords-extraction.ts
// Valida que parseCoordsFromHtml (Properati) y la regex fallback de MetroCuadrado
// extraen coords correctamente sobre las 4 URLs reales del probe Phase 10.
// NO toca DB. Solo HTTP fetch + regex + validación.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface TestCase {
  portal: 'properati' | 'metrocuadrado';
  url: string;
  expected: { lat: number; lng: number };
}

const TEST_CASES: TestCase[] = [
  // Properati — Bogotá
  {
    portal: 'properati',
    url: 'https://www.properati.com.co/detalle/14032-32-eac4-46e1d1f87f72-19cfd10-b70c-7406',
    expected: { lat: 4.699150899999999, lng: -74.0518031 },
  },
  {
    portal: 'properati',
    url: 'https://www.properati.com.co/detalle/14032-32-daa-661aced92418-19c7243-80e0-737f',
    expected: { lat: 4.678102, lng: -74.0410069 },
  },
  // MetroCuadrado — Barranquilla
  {
    portal: 'metrocuadrado',
    url: 'https://www.metrocuadrado.com/inmueble/arriendo-apartamento-barranquilla-2-habitaciones-2-banos-1-garajes/20424-M6594990',
    expected: { lat: 10.9960785, lng: -74.841705 },
  },
  {
    portal: 'metrocuadrado',
    url: 'https://www.metrocuadrado.com/inmueble/arriendo-apartamento-barranquilla-2-habitaciones-2-banos-1-garajes/3774-M6257510',
    expected: { lat: 11.014193, lng: -74.882706 },
  },
];

async function main() {
  const { fetchText } = await import('../lib/scrapers/shared/http');
  const { parseCoordsFromHtml: parsePropConv, PROPERATI_UA } = await import(
    '../lib/scrapers/properati'
  );
  const { isValidColombiaCoord } = await import('../lib/scrapers/shared/normalize');

  // Re-implementación del extractor de MetroCuadrado para testear el regex
  // fallback aislado (mismo patrón que el código de producción).
  const M2_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const M2_COORDS_RE =
    /\\"coordinates\\":\{\\"lon\\":(-?[0-9.]+),\\"lat\\":(-?[0-9.]+)\}/;
  function parseM2Coords(html: string): { latitude: number; longitude: number } | null {
    const m = html.match(M2_COORDS_RE);
    if (!m) return null;
    const lng = parseFloat(m[1]);
    const lat = parseFloat(m[2]);
    if (!isValidColombiaCoord(lat, lng)) return null;
    return { latitude: lat, longitude: lng };
  }

  console.log(`\n🧪 Smoke: extracción de coords sobre 4 URLs reales\n`);

  let pass = 0;
  let fail = 0;

  for (const tc of TEST_CASES) {
    const ua = tc.portal === 'properati' ? PROPERATI_UA : M2_UA;
    const t0 = Date.now();
    let html: string;
    try {
      html = await fetchText(tc.url, { userAgent: ua });
    } catch (err) {
      console.log(`❌ ${tc.portal} ${tc.url.slice(-30)}: fetch failed (${err})`);
      fail++;
      continue;
    }
    const ms = Date.now() - t0;

    const parsed =
      tc.portal === 'properati' ? parsePropConv(html) : parseM2Coords(html);

    if (!parsed) {
      console.log(`❌ ${tc.portal} ${tc.url.slice(-30)}: no se extrajeron coords (${ms}ms)`);
      fail++;
      continue;
    }

    // Tolerancia: 1e-6 (precisión float).
    const latOk = Math.abs(parsed.latitude - tc.expected.lat) < 1e-6;
    const lngOk = Math.abs(parsed.longitude - tc.expected.lng) < 1e-6;
    if (latOk && lngOk) {
      console.log(
        `✅ ${tc.portal.padEnd(13)} ${tc.url.slice(-25)}: lat=${parsed.latitude}, lng=${parsed.longitude} (${ms}ms)`
      );
      pass++;
    } else {
      console.log(
        `❌ ${tc.portal} ${tc.url.slice(-30)}: ` +
          `extracted (${parsed.latitude}, ${parsed.longitude}) ` +
          `expected (${tc.expected.lat}, ${tc.expected.lng})`
      );
      fail++;
    }
  }

  // Test adicional: validar que el bounding box rechaza coords inválidas.
  console.log(`\n──── Tests negativos (validación) ────`);
  const negativeTests: Array<{ label: string; lat: number; lng: number; expected: boolean }> = [
    { label: 'Bogotá válido', lat: 4.6, lng: -74.05, expected: true },
    { label: 'Cartagena válido', lat: 10.4, lng: -75.5, expected: true },
    { label: '(0, 0) placeholder', lat: 0, lng: 0, expected: false },
    { label: 'Buenos Aires (fuera)', lat: -34.6, lng: -58.4, expected: false },
    { label: 'orden invertido (Colombia)', lat: -74.05, lng: 4.6, expected: false },
    { label: 'NaN', lat: NaN, lng: -74.05, expected: false },
  ];
  for (const t of negativeTests) {
    const got = isValidColombiaCoord(t.lat, t.lng);
    const ok = got === t.expected;
    console.log(`${ok ? '✅' : '❌'} ${t.label.padEnd(30)} (${t.lat}, ${t.lng}) → ${got}`);
    ok ? pass++ : fail++;
  }

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
