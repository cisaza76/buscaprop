// Diagnóstico puntual (no forma parte del scraper): confirma si un navegador
// Chromium headless (Playwright), corriendo con acceso real a internet
// (GitHub Actions, no el sandbox de un agente), logra cargar Properati o si
// recibe el mismo bloqueo (401/403) que el cliente HTTP plano del scraper.
//
// Resultado esperado si el bloqueo es fingerprinting/anti-bot (TLS, headers,
// falta de ejecución de JS, señales de automatización tipo navigator.webdriver):
// headless también bloqueado -> confirma que migrar a Playwright NO resuelve nada.
//
// Resultado esperado si el bloqueo es específico de clientes no-navegador
// (sin motor JS, sin fingerprint de browser real):
// headless carga OK -> Playwright/navegador real sí es una salida viable.
//
// Uso: node scripts/diag-properati-headless.mjs
// HEADLESS=false -> lanza Chromium con ventana real (requiere xvfb-run en CI).
// Sirve para aislar si el bloqueo es por IP/origen de red (afecta a ambos modos)
// o por fingerprint de "headless" específicamente (solo afecta al modo headless).
import { chromium } from 'playwright';

const URL = 'https://www.properati.com.co/s/bogota-d-c-colombia/apartamento/venta';
const HEADLESS = process.env.HEADLESS !== 'false';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function main() {
  console.log(`[diag] Lanzando Chromium (headless=${HEADLESS})...`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: 'es-CO',
  });
  const page = await context.newPage();

  let status = null;
  page.on('response', (res) => {
    if (res.url() === URL || (status === null && res.url().startsWith(URL))) {
      status = res.status();
    }
  });

  console.log(`[diag] Navegando a ${URL}`);
  let navError = null;
  try {
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = resp ? resp.status() : status;
  } catch (e) {
    navError = e.message;
  }

  const title = await page.title().catch(() => '(sin título)');
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
  const cardCount = await page.locator('article.snippet, article[data-idanuncio]').count().catch(() => -1);

  console.log('----------------------------------------');
  console.log(`[diag] headless: ${HEADLESS}`);
  console.log(`[diag] HTTP status: ${status}`);
  console.log(`[diag] navError: ${navError}`);
  console.log(`[diag] title: ${title}`);
  console.log(`[diag] cardCount (article.snippet): ${cardCount}`);
  console.log(`[diag] bodyText[0:500]:\n${bodyText}`);
  console.log('----------------------------------------');

  const blocked =
    navError !== null ||
    (status !== null && status >= 400) ||
    /acceso denegado|access denied|blocked|verificando|verifying|captcha/i.test(bodyText);

  console.log(`[diag] CONCLUSION: ${blocked ? 'BLOQUEADO incluso con navegador headless real' : 'OK — headless SÍ logró cargar el contenido'}`);

  await browser.close();
  process.exit(blocked ? 1 : 0);
}

main().catch((e) => {
  console.error('[diag] Error fatal:', e);
  process.exit(2);
});
