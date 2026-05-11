// scripts/recon/test-fincaraiz-parser.ts
// Verifica que el fix del parser de Fincaraíz extrae city/neighborhood
// correctamente para los casos buggy detectados en producción.
import '../_load-env';
import { parseFincaraizSlug } from '../../lib/scrapers/fincaraiz';

const CASES: Array<[string, string, string | null]> = [
  // [url, expectedCity, expectedNeighborhoodIncludes]
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-el-guaciro-san-vicente/193214349', 'san-vicente', 'el-guaciro'],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-san-jeronimo/191489050', 'san-jeronimo', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-san-miguel/193024278', 'san-miguel', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-paso-real-santafe-de-antioquia/193204528', 'santafe-de-antioquia', 'paso-real'],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-velez-apartado/193595257', 'apartado', 'velez'],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-el-carmen-de-viboral/193617023', 'el-carmen-de-viboral', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-guatape/192820059', 'guatape', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-la-macarena/193438817', 'la-macarena', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-el-rosario/193676105', 'el-rosario', null],
  ['https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-santa-isabel/193705566', 'santa-isabel', null],
  // Casos ya cubiertos pre-fix:
  ['https://www.fincaraiz.com.co/casa-en-venta-en-chico-norte-bogota/123456', 'bogota', 'chico-norte'],
  ['https://www.fincaraiz.com.co/apartamento-en-arriendo-en-medellin/123456', 'medellin', null],
];

let pass = 0, fail = 0;
for (const [url, expectedCity, expectedHood] of CASES) {
  const parsed = parseFincaraizSlug(url);
  const cityOk = parsed?.city === expectedCity;
  const hoodOk = expectedHood === null ? !parsed?.neighborhood : parsed?.neighborhood === expectedHood;
  const flag = cityOk && hoodOk ? '✓' : '✗';
  if (cityOk && hoodOk) pass++; else fail++;
  console.log(`${flag} city='${parsed?.city}' hood='${parsed?.neighborhood ?? '(none)'}' (expected city='${expectedCity}', hood='${expectedHood ?? '(none)'}')`);
  if (!cityOk || !hoodOk) {
    console.log(`    url: ${url}`);
  }
}
console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
