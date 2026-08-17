// scripts/test-ciencuadras-parser.ts
// Smoke test del parser Ciencuadras contra fixtures locales.

import fs from 'fs';
import path from 'path';
import {
  parseCiencuadrasListing,
  parseCiencuadrasSlug,
  parseCiencuadrasDetailState,
  extractCiencuadrasContact,
  normalizeCoMobile,
} from '../lib/scrapers/ciencuadras';

const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/ciencuadras');

console.log('='.repeat(60));
console.log('CIENCUADRAS PARSER SMOKE TEST');
console.log('='.repeat(60));

// Slug parsing
console.log('\n━━ Slug parsing tests ━━');
const slugs = [
  'https://www.ciencuadras.com/inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891',
  'https://www.ciencuadras.com/inmueble/casa-en-venta-en-casa-blanca-suba-bogota-3091390',
  'https://www.ciencuadras.com/inmueble/oficina-en-venta-en-bella-suiza-bogota-3499669',
  'https://www.ciencuadras.com/inmueble/apartamento-en-arriendo-en-chapinero-bogota-1234567',
];
for (const u of slugs) {
  const s = parseCiencuadrasSlug(u);
  console.log(`  ${u.split('/').pop()?.slice(0, 60)}`);
  console.log(`    →`, s);
}

// ── Regresión: operación DUAL "arriendo-o-venta" (incidente 2026-06-02) ──
// Antes devolvían null → el parser caía en masa → loop drenaba sitemaps →
// storm de Inngest. Dual debe parsear como listing_type='venta'.
console.log('\n━━ Slug dual (arriendo-o-venta) — regresión ━━');
let slugFails = 0;
const assertSlug = (u: string, wantOp: string | null) => {
  const s = parseCiencuadrasSlug(u);
  const got = s?.op ?? null;
  const ok = got === wantOp;
  console.log(`  ${ok ? '✅' : '❌'} op=${got} (esperado ${wantOp}) ← ${u.split('/').pop()?.slice(0, 55)}`);
  if (!ok) slugFails++;
};
assertSlug('https://www.ciencuadras.com/inmueble/apartamento-en-arriendo-o-venta-en-castropol-medellin-3712345', 'venta');
assertSlug('https://www.ciencuadras.com/inmueble/casa-en-venta-o-arriendo-en-el-nogal-bogota-3712346', 'venta');
assertSlug('https://www.ciencuadras.com/inmueble/apartamento-en-arriendo-en-chapinero-bogota-1234567', 'arriendo'); // simple no regresiona
assertSlug('https://www.ciencuadras.com/inmueble/casa-en-venta-en-casa-blanca-suba-bogota-3091390', 'venta');
if (slugFails > 0) {
  console.log(`\n❌ ${slugFails} aserción(es) de slug dual fallaron`);
  process.exit(1);
}
console.log('  ✅ slug dual OK');

// Detail parsing
console.log('\n━━ Detail page parsing ━━');
const html = fs.readFileSync(path.join(FIX, 'detail-tuna-alta-venta.html'), 'utf-8');
const url = 'https://www.ciencuadras.com/inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891';
const item = parseCiencuadrasListing(url, html);
if (!item) {
  console.log('  ❌ parseCiencuadrasListing returned null');
} else {
  console.log('  ✅ parsed');
  console.log(`    title:        ${item.title}`);
  console.log(`    type / op:    ${item.property_type} ${item.listing_type}`);
  console.log(`    city / hood:  ${item.city} / ${item.neighborhood ?? '—'}`);
  console.log(
    `    price:        $${item.price_cop.toLocaleString('es-CO')} | ${item.bedrooms ?? '?'}h/${item.bathrooms ?? '?'}b/${item.area_m2 ?? '?'}m²`
  );
  console.log(`    geo:          ${item.latitude} / ${item.longitude}`);
  console.log(`    photos:       ${item.photos.length}`);
  console.log(`    desc:         ${item.description?.slice(0, 100)}…`);
}

// ── Contacto: normalización de celular colombiano ──────────────────────
// Ciencuadras mezcla celulares ('57-3114186049', '3204354576'), fijos con
// la numeración nueva 60X ('6053859191'), fijos viejos de 7 dígitos y
// basura ('42044686'). contact_phone alimenta links wa.me, así que sólo
// sirve un celular real: 57 + 3XXXXXXXXX. Guardar un fijo produciría un
// link de WhatsApp muerto — peor que no guardar nada.
console.log('\n━━ normalizeCoMobile ━━');
let phoneFails = 0;
const assertPhone = (raw: string, want: string | null) => {
  const got = normalizeCoMobile(raw);
  const ok = got === want;
  console.log(`  ${ok ? '✅' : '❌'} ${JSON.stringify(raw).padEnd(18)} → ${got} (esperado ${want})`);
  if (!ok) phoneFails++;
};
assertPhone('57-3114186049', '573114186049');   // prefijo con guion
assertPhone('3204354576', '573204354576');      // celular pelado, 10 dígitos
assertPhone('+57 311 4186049', '573114186049'); // con + y espacios
assertPhone('573114186049', '573114186049');    // ya normalizado
assertPhone('42044686', null);                  // basura, 8 dígitos
assertPhone('576053859191', null);              // fijo 605 con prefijo país
assertPhone('(605)6651648', null);              // fijo con indicativo
assertPhone('6012566701', null);                // fijo numeración nueva 601
assertPhone('2635400', null);                   // fijo viejo 7 dígitos
assertPhone('6016014853000', null);             // 13 dígitos, corrupto
assertPhone('', null);
if (phoneFails > 0) {
  console.log(`\n❌ ${phoneFails} aserción(es) de normalizeCoMobile fallaron`);
  process.exit(1);
}

// ── Contacto: extracción desde el blob detail-state ────────────────────
// El blob es Angular TransferState escapado (&q; en vez de comillas), bajo
// <script id="detail-state">. La ficha vive en la key detail-property-*.
console.log('\n━━ extractCiencuadrasContact ━━');
let contactFails = 0;
const assertContact = (
  label: string,
  state: unknown,
  want: { contact_phone?: string; company_name?: string }
) => {
  const got = extractCiencuadrasContact(state);
  const ok =
    got.contact_phone === want.contact_phone && got.company_name === want.company_name;
  console.log(
    `  ${ok ? '✅' : '❌'} ${label.padEnd(46)} phone=${got.contact_phone ?? '—'} company=${got.company_name ?? '—'}`
  );
  if (!ok) {
    console.log(`      esperado phone=${want.contact_phone ?? '—'} company=${want.company_name ?? '—'}`);
    contactFails++;
  }
};
// Helper: arma un state mínimo con la forma real del portal.
const st = (generalData: Record<string, unknown>, dataStrip: Record<string, unknown> = {}) => ({
  'detail-property-/inmueble/x-1': { generalData, dataStrip },
});

assertContact(
  'whatsAppContact válido gana',
  st(
    { whatsAppContact: '3204354576', advisoryPhone: '57-3219506490', allowContactWhatsapp: true },
    { realStateName: 'Su Inmueble' }
  ),
  { contact_phone: '573204354576', company_name: 'Su Inmueble' }
);
assertContact(
  'whatsAppContact inválido → advisorWhatsapp',
  st({ whatsAppContact: '42044686', advisorWhatsapp: '57-3173700766' }, { realStateName: 'L2L' }),
  { contact_phone: '573173700766', company_name: 'L2L' }
);
assertContact(
  'sin whatsApp → advisoryPhone',
  st({ advisoryPhone: '57-3112236978' }, { realStateName: 'Red' }),
  { contact_phone: '573112236978', company_name: 'Red' }
);
assertContact(
  'fallback a phoneList type C visible',
  st({ phoneList: [{ phone: '57-3126787081', isVisible: '1', type: 'C' }] }, { realStateName: 'X' }),
  { contact_phone: '573126787081', company_name: 'X' }
);
assertContact(
  'phoneList type F (fijo) se descarta',
  st({ phoneList: [{ phone: '(605)6651648', isVisible: '1', type: 'F' }] }, { realStateName: 'X' }),
  { contact_phone: undefined, company_name: 'X' }
);
assertContact(
  'phoneList isVisible=0 se descarta',
  st({ phoneList: [{ phone: '57-3008142120', isVisible: '0', type: 'C' }] }, { realStateName: 'X' }),
  { contact_phone: undefined, company_name: 'X' }
);
assertContact(
  'consentimiento negado → sin teléfono',
  st(
    { whatsAppContact: '3204354576', allowContactWhatsapp: false, allowContactCall: false },
    { realStateName: 'X' }
  ),
  { contact_phone: undefined, company_name: 'X' }
);
assertContact(
  'company: advisoryName cuando falta realStateName',
  st({ whatsAppContact: '3204354576', advisoryName: 'SUINMUEBLE SAS' }),
  { contact_phone: '573204354576', company_name: 'SUINMUEBLE SAS' }
);
// Ficha caída: Ciencuadras responde 200 con el blob vacío en vez de 404.
assertContact(
  'ficha caída (Property Code without results)',
  { 'detail-property-/inmueble/x-1': { error: true, message: 'Property Code without results' } },
  { contact_phone: undefined, company_name: undefined }
);
assertContact('state nulo', null, { contact_phone: undefined, company_name: undefined });
if (contactFails > 0) {
  console.log(`\n❌ ${contactFails} aserción(es) de extractCiencuadrasContact fallaron`);
  process.exit(1);
}

// ── Integración: contacto sobre el fixture real ────────────────────────
console.log('\n━━ Contacto end-to-end sobre fixture real ━━');
let e2eFails = 0;
const state = parseCiencuadrasDetailState(html);
if (!state) {
  console.log('  ❌ parseCiencuadrasDetailState devolvió null sobre el fixture');
  e2eFails++;
} else {
  console.log('  ✅ detail-state parseado');
}
if (item?.contact_phone !== '573113678398') {
  console.log(`  ❌ contact_phone = ${item?.contact_phone} (esperado 573113678398)`);
  e2eFails++;
} else {
  console.log(`  ✅ contact_phone = ${item.contact_phone}`);
}
if (item?.company_name !== 'AKI Y AHORA') {
  console.log(`  ❌ company_name = ${item?.company_name} (esperado 'AKI Y AHORA')`);
  e2eFails++;
} else {
  console.log(`  ✅ company_name = ${item.company_name}`);
}
// No hay nombre de persona en el portal: advisoryName y realStateName son
// ambos razón social. Dejar contact_name vacío en vez de duplicar la empresa.
if (item?.contact_name !== undefined) {
  console.log(`  ❌ contact_name = ${item?.contact_name} (esperado undefined)`);
  e2eFails++;
} else {
  console.log('  ✅ contact_name vacío (el portal no publica persona)');
}
if (e2eFails > 0) {
  console.log(`\n❌ ${e2eFails} aserción(es) de contacto e2e fallaron`);
  process.exit(1);
}

console.log('\nDONE');
