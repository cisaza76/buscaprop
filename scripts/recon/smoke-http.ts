// scripts/recon/smoke-http.ts
// Verifica que el http.ts hardenizado funciona end-to-end contra cada portal.
// 3 requests por portal (≥1500ms entre cada uno por el rate limit interno).
// Si algo timeoutea o devuelve no-200, reporta para investigar.
import { fetchText, HttpError } from '../../lib/scrapers/shared/http';

const targets = [
  'https://www.ciencuadras.com/',
  'https://www.fincaraiz.com.co/',
  'https://www.metrocuadrado.com/',
  'https://www.properati.com.co/',
];

async function main() {
  for (const url of targets) {
    const t0 = Date.now();
    try {
      const html = await fetchText(url);
      const ms = Date.now() - t0;
      console.log(`✓ ${url} · ${ms}ms · ${html.length}b`);
    } catch (e) {
      const ms = Date.now() - t0;
      if (e instanceof HttpError) {
        console.log(`✗ ${url} · ${ms}ms · HttpError ${e.status} · ${(e.body ?? '').slice(0, 80)}`);
      } else {
        console.log(`✗ ${url} · ${ms}ms · ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
main();
