// scripts/smoke-certificate.ts
// Test E2E: parse PDF real + best-effort SNR validation. NO toca DB.
//
// Uso: tsx scripts/smoke-certificate.ts <path-to-pdf>

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('usage: tsx scripts/smoke-certificate.ts <path-to-pdf>');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.log(`❌ no existe: ${file}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(file);
  console.log(`\n🧪 Smoke certificate parsing + SNR validation`);
  console.log(`   file: ${file} (${(buf.length / 1024).toFixed(1)} KB)\n`);

  const { extractTextFromPDF, parseCertificateText } = await import(
    '../lib/certificates/pdf-parser'
  );
  const { validateWithSNR } = await import('../lib/certificates/snr');

  // ── 1. Parse PDF ──
  console.log('── 1. Parse PDF ──');
  const t0 = Date.now();
  const text = await extractTextFromPDF(buf);
  console.log(`   text extracted: ${text.length} chars in ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const parsed = parseCertificateText(text);
  console.log(`   parsed in ${Date.now() - t1}ms`);
  console.log();
  console.log(`   PIN:               ${parsed.pin}`);
  console.log(`   Matrícula:         ${parsed.matricula}`);
  console.log(`   NUPRE:             ${parsed.nupre}`);
  console.log(`   Código Catastral:  ${parsed.codigo_catastral}`);
  console.log(`   Estado folio:      ${parsed.estado_folio}`);
  console.log(`   Total anotaciones: ${parsed.total_anotaciones}`);
  console.log(`   Impreso:           ${parsed.certificate_issued_at}`);
  console.log();
  console.log(`   Anotaciones parseadas: ${parsed.anotaciones.length}`);
  for (const a of parsed.anotaciones) {
    const cancel = a.is_cancelled ? ' [CANCELADA]' : '';
    const valor = a.valor_acto_cop
      ? ` · $${a.valor_acto_cop.toLocaleString('es-CO')}`
      : '';
    console.log(
      `   #${String(a.numero).padStart(2, '0')} ${a.fecha} · ${a.categoria.padEnd(12)}${valor}${cancel}`
    );
  }
  console.log();
  console.log(`   Propietario actual:    ${parsed.current_owner}`);
  console.log(`   ID propietario:        ${parsed.current_owner_id}`);
  console.log(`   Última compraventa:    ${parsed.last_sale_date}`);
  console.log(
    `   Valor última compra:   ${parsed.last_sale_value_cop ? `$${parsed.last_sale_value_cop.toLocaleString('es-CO')}` : '—'}`
  );
  console.log(`   Gravámenes activos:    ${parsed.active_liens_count}`);
  if (parsed.active_liens_summary) {
    console.log(`   Resumen gravámenes:`);
    console.log(`     ${parsed.active_liens_summary}`);
  }

  // ── 2. SNR validation (best-effort) ──
  console.log('\n── 2. SNR validation (best-effort) ──');
  if (!parsed.pin) {
    console.log('   skip: no PIN');
  } else {
    const t2 = Date.now();
    const snr = await validateWithSNR(parsed.pin, parsed.certificate_issued_at);
    console.log(`   completed in ${Date.now() - t2}ms`);
    console.log(`   status:        ${snr.status}`);
    if (snr.error_message) console.log(`   error:         ${snr.error_message}`);
    if (snr.raw_signal) {
      console.log(`   raw_signal:    ${snr.raw_signal.slice(0, 200)}...`);
    }
  }

  // ── Verificaciones ──
  console.log('\n── Verificaciones ──');
  let pass = 0;
  let fail = 0;
  const checks: Array<[string, boolean]> = [
    ['PIN extraído', !!parsed.pin],
    ['PIN tiene 19 dígitos', /^\d{19}$/.test(parsed.pin ?? '')],
    ['Matrícula extraída', !!parsed.matricula],
    ['NUPRE extraído', !!parsed.nupre],
    ['Estado folio extraído', !!parsed.estado_folio],
    [
      'Total anotaciones coincide con parseado',
      parsed.total_anotaciones === parsed.anotaciones.length,
    ],
    ['Fecha de impresión extraída', !!parsed.certificate_issued_at],
    ['Propietario actual identificado', !!parsed.current_owner],
    ['Última compraventa identificada', !!parsed.last_sale_date],
  ];
  for (const [label, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    ok ? pass++ : fail++;
  }

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
