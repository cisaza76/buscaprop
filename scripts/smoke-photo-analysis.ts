// scripts/smoke-photo-analysis.ts
// Verifica el flujo de análisis visual:
//   1. Toma una propiedad real con fotos
//   2. Llama a analyzePropertyPhotos
//   3. Verifica que: el cache funciona, el shape del resultado es válido,
//      y NO hay afirmaciones prohibidas en `summary` o `visible_features`
//      (ej: antigüedad, humedad, grietas).

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const FORBIDDEN_PHRASES = [
  /hace\s+\d+\s*año/i,
  /\d+\s*años de antigüedad/i,
  /humeda/i,
  /grietas?\b/i,
  /filtraci/i,
  /instalaci(ó|o)n el(é|e)ctrica/i,
  /tuber(ía|ia)/i,
  /renovad[oa]\s+(en|hace)/i,
];

// Las fotos del seed son placehold.co (texto en gris). Para un smoke real
// usamos URLs públicas de fotos de apartments (Unsplash CDN, libres y estables).
// Esto se reemplazará por fotos reales cuando los scrapers las extraigan.
const REAL_TEST_PHOTOS = [
  // Apartment living rooms (public Unsplash URLs)
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200',
];

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { analyzePropertyPhotos } = await import('../lib/ai/photo-analysis');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Crear propiedad temporal con fotos reales para el smoke. Cleanup al final.
  const { data: createdProp, error: createErr } = await sb
    .from('properties')
    .insert({
      source_portal: 'fincaraiz',
      source_url: `https://test-smoke.local/${Date.now()}`,
      title: '[SMOKE TEST] Propiedad temporal — borrar',
      description: 'Test fixture',
      price_cop: 100_000_000,
      city: 'Bogotá',
      property_type: 'apartamento',
      listing_type: 'venta',
      photos: REAL_TEST_PHOTOS,
      is_duplicate: false,
      scraped_at: new Date().toISOString(),
    })
    .select('id, photos')
    .single();
  if (createErr || !createdProp) {
    console.log(`❌ No pude crear propiedad temporal: ${createErr?.message}`);
    process.exit(1);
  }
  const candidate = { id: createdProp.id, photos: createdProp.photos };
  console.log(
    `Propiedad temporal creada: ${candidate.id} (${(candidate.photos as string[]).length} fotos reales)`
  );

  // Cleanup helper — corre incluso si fallamos.
  const cleanup = async () => {
    await sb.from('photo_analyses').delete().eq('property_id', candidate.id);
    await sb.from('properties').delete().eq('id', candidate.id);
    console.log('✅ cleanup OK');
  };
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  // 1ra corrida — sin cache.
  const t0 = Date.now();
  const r1 = await analyzePropertyPhotos(candidate.id, { force: true });
  const ms1 = Date.now() - t0;
  console.log(`\n──── Run 1 (sin cache, ${ms1}ms) ────`);
  console.log(`photos analizadas: ${r1.photos.length}`);
  console.log(`tokens: input=${r1.tokens_used.input} output=${r1.tokens_used.output}`);
  if (r1.warning) console.log(`⚠️  warning: ${r1.warning}`);
  if (r1.aggregate) {
    console.log('aggregate:');
    console.log(`  light_level_overall: ${r1.aggregate.light_level_overall}`);
    console.log(`  appearance_overall: ${r1.aggregate.appearance_overall}`);
    console.log(`  style_overall: ${r1.aggregate.style_overall}`);
    console.log(`  furnished_overall: ${r1.aggregate.furnished_overall}`);
    console.log(`  rooms_seen: [${r1.aggregate.rooms_seen.join(', ')}]`);
    console.log(`  visible_features:`);
    for (const f of r1.aggregate.visible_features) console.log(`    · ${f}`);
    console.log(`  summary: "${r1.aggregate.summary}"`);
  }

  // 2da corrida — debería pegarle al cache (0 tokens, mucho más rápida).
  const t1 = Date.now();
  const r2 = await analyzePropertyPhotos(candidate.id);
  const ms2 = Date.now() - t1;
  console.log(`\n──── Run 2 (con cache, ${ms2}ms) ────`);
  console.log(`tokens: input=${r2.tokens_used.input} output=${r2.tokens_used.output}`);

  console.log('\n──── Verificaciones ────');
  let pass = 0,
    fail = 0;

  const c1: Array<[string, boolean]> = [
    ['Run 1 analizó al menos 2 fotos', r1.photos.length >= 2],
    ['Run 1 produjo aggregate', r1.aggregate !== null],
    ['Run 1 consumió tokens (no era cache)', r1.tokens_used.input > 0],
    ['Run 2 usó cache (0 tokens nuevos)', r2.tokens_used.input === 0],
    ['Run 2 mucho más rápido', ms2 < ms1 / 2],
    ['Cache misma cantidad de fotos', r1.photos.length === r2.photos.length],
  ];

  for (const [label, ok] of c1) {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    ok ? pass++ : fail++;
  }

  // Verificar guardrails: NINGÚN summary ni visible_feature contiene frases prohibidas.
  if (r1.aggregate) {
    const allText = [
      r1.aggregate.summary,
      ...r1.aggregate.visible_features,
      ...r1.photos.map((p) => p.analysis.notes),
    ].join(' | ');

    let foundForbidden = false;
    for (const re of FORBIDDEN_PHRASES) {
      if (re.test(allText)) {
        console.log(`❌ Frase prohibida detectada: ${re} en: "${allText}"`);
        foundForbidden = true;
        fail++;
      }
    }
    if (!foundForbidden) {
      console.log(`✅ Ninguna afirmación prohibida (antigüedad/humedad/grietas)`);
      pass++;
    }
  }

  await cleanup();
  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  if (err instanceof Error && /property_id.*photo_url|does not exist|could not find.*table/i.test(err.message)) {
    console.error('\n⚠️  Aplicá la migration 009 en Supabase SQL editor.');
  }
  process.exit(1);
});
