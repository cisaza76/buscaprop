// scripts/populate-neighborhood-aliases.ts
// Popular neighborhood_aliases con:
//   1. Cada nombre canónico real de la BD → alias = nombre normalizado
//   2. Aliases manuales curados para los casos comunes (Rosales→Los Rosales,
//      Chico→El Chicó, etc.)
//
// Idempotente: re-correr no duplica (UNIQUE(city, alias) + upsert).

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

// Aliases manuales curados — variaciones que el user dice y que NO se
// derivan automáticamente del nombre canónico. El alias está en formato
// normalizado (lowercase + sin tildes + sin artículos).
const MANUAL_ALIASES: Array<{ city: string; alias: string; canonical: string }> = [
  // Rosales: BD tiene "Los Rosales", users dicen "Rosales"
  { city: 'Bogotá', alias: 'rosales', canonical: 'Los Rosales' },
  { city: 'Bogotá', alias: 'los rosales', canonical: 'Los Rosales' },

  // Chicó: BD tiene "El Chicó", users dicen "Chico"
  { city: 'Bogotá', alias: 'chico', canonical: 'El Chicó' },
  { city: 'Bogotá', alias: 'chicó', canonical: 'El Chicó' },
  { city: 'Bogotá', alias: 'el chico', canonical: 'El Chicó' },

  // Nogal
  { city: 'Bogotá', alias: 'nogal', canonical: 'El Nogal' },
  { city: 'Bogotá', alias: 'el nogal', canonical: 'El Nogal' },

  // Refugio
  { city: 'Bogotá', alias: 'refugio', canonical: 'El Refugio' },
  { city: 'Bogotá', alias: 'el refugio', canonical: 'El Refugio' },

  // Cabrera
  { city: 'Bogotá', alias: 'cabrera', canonical: 'La Cabrera' },
  { city: 'Bogotá', alias: 'la cabrera', canonical: 'La Cabrera' },

  // Macarena
  { city: 'Bogotá', alias: 'macarena', canonical: 'La Macarena' },
  { city: 'Bogotá', alias: 'la macarena', canonical: 'La Macarena' },

  // Candelaria
  { city: 'Bogotá', alias: 'candelaria', canonical: 'La Candelaria' },
  { city: 'Bogotá', alias: 'la candelaria', canonical: 'La Candelaria' },

  // Usaquén — variantes con/sin tilde
  { city: 'Bogotá', alias: 'usaquen', canonical: 'Usaquén' },

  // Santa Bárbara variantes
  { city: 'Bogotá', alias: 'santa barbara', canonical: 'Santa Bárbara' },
  { city: 'Bogotá', alias: 'santa bárbara', canonical: 'Santa Bárbara' },

  // Country Club
  { city: 'Bogotá', alias: 'country', canonical: 'Country Club' },
  { city: 'Bogotá', alias: 'country club', canonical: 'Country Club' },

  // Quinta Camacho
  { city: 'Bogotá', alias: 'quinta camacho', canonical: 'Quinta Camacho' },

  // Chapinero variants (cuando user dice "Chapinero" sin "Norte"/"Alto")
  { city: 'Bogotá', alias: 'chapinero', canonical: 'Chapinero' },
  { city: 'Bogotá', alias: 'chapinero norte', canonical: 'Chapinero Norte' },
  { city: 'Bogotá', alias: 'chapinero alto', canonical: 'Chapinero Alto' },

  // Otras ciudades
  { city: 'Medellín', alias: 'poblado', canonical: 'El Poblado' },
  { city: 'Medellín', alias: 'el poblado', canonical: 'El Poblado' },
  { city: 'Medellín', alias: 'laureles', canonical: 'Laureles' },
  { city: 'Medellín', alias: 'sabaneta', canonical: 'Sabaneta' },
  { city: 'Medellín', alias: 'envigado', canonical: 'Envigado' },

  { city: 'Cartagena', alias: 'bocagrande', canonical: 'Bocagrande' },
  { city: 'Cartagena', alias: 'castillogrande', canonical: 'Castillogrande' },
  { city: 'Cartagena', alias: 'el laguito', canonical: 'El Laguito' },
  { city: 'Cartagena', alias: 'centro historico', canonical: 'Centro Histórico' },
  { city: 'Cartagena', alias: 'getsemani', canonical: 'Getsemaní' },
  { city: 'Cartagena', alias: 'getsemaní', canonical: 'Getsemaní' },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log('\n📋 Populando neighborhood_aliases\n');

  // ── Paso 1: por cada barrio canónico real de la BD, agregar su forma
  //    normalizada como alias. Esto cubre el caso default (alias = nombre
  //    canónico normalizado).
  console.log('── 1. Auto-aliases desde nombres canónicos en BD ──');
  const { data: canonicals } = await sb
    .from('properties')
    .select('city, neighborhood')
    .not('neighborhood', 'is', null)
    .limit(50000);
  const seen = new Set<string>();
  const autoAliases: Array<{ city: string; alias: string; canonical: string }> = [];
  for (const r of canonicals ?? []) {
    const city = r.city as string;
    const canonical = r.neighborhood as string;
    if (!city || !canonical) continue;
    const key = `${city}|${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const alias = normalize(canonical);
    if (alias.length === 0) continue;
    autoAliases.push({ city, alias, canonical });
  }
  console.log(`  ${autoAliases.length} aliases auto-generados (canónico normalizado → canónico)`);

  // ── Paso 2: aliases manuales curados ──
  console.log(`── 2. Aliases manuales curados: ${MANUAL_ALIASES.length}`);

  // Combinar: auto primero, manuales después (manuales pisan auto si overlap).
  const combined = new Map<string, { city: string; alias: string; canonical: string }>();
  for (const a of autoAliases) {
    combined.set(`${a.city}|${a.alias}`, a);
  }
  for (const a of MANUAL_ALIASES) {
    combined.set(`${a.city}|${normalize(a.alias)}`, {
      city: a.city,
      alias: normalize(a.alias),
      canonical: a.canonical,
    });
  }
  const final = [...combined.values()];
  console.log(`  Total a insertar: ${final.length}\n`);

  // ── Insertar (upsert idempotente) ──
  const { error } = await sb
    .from('neighborhood_aliases')
    .upsert(
      final.map((a) => ({
        city: a.city,
        alias: a.alias,
        canonical_name: a.canonical,
      })),
      { onConflict: 'city,alias' }
    );
  if (error) {
    console.error(`❌ ${error.message}`);
    if (/does not exist/i.test(error.message) || /could not find/i.test(error.message)) {
      console.error('\n   Aplicá la migration 012 primero.');
    }
    process.exit(1);
  }

  // Verificar.
  const { count } = await sb
    .from('neighborhood_aliases')
    .select('*', { count: 'exact', head: true });
  console.log(`✅ ${count} aliases en la tabla\n`);

  // Sanity check: el caso del user.
  const { data: rosales } = await sb
    .from('neighborhood_aliases')
    .select('canonical_name')
    .eq('city', 'Bogotá')
    .eq('alias', 'rosales');
  console.log(`Test: alias="rosales" en Bogotá → "${rosales?.[0]?.canonical_name}"`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
