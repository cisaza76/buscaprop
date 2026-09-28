// scripts/test-sweep-health.ts
// Test unitario de evaluateSweepHealth (lib/scrapers/shared/sweep-health.ts).
// Función pura — no toca red ni Supabase.
//
// Regresión que previene: el barrido de disponibilidad reconoce avisos
// retirados por frases exactas de cada portal. Si un portal cambia la frase,
// el barrido reporta "0 retirados" y se ve sano mientras el inventario muerto
// se acumula — el mismo patrón de falso verde de PGRST125, Properati (401) y el
// parser de Fincaraiz (JSON-LD). También: barrido que dejó de correr.

import { evaluateSweepHealth } from '../lib/scrapers/shared/sweep-health';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
}
const kind = (checked: number, gone: number) => evaluateSweepHealth({ portal: 'fincaraiz', checked, gone })?.kind ?? null;

console.log('SWEEP HEALTH TEST');
eq('tasa normal (40%) → sano', kind(700, 280), null);
eq('tasa baja pero real (3%) → sano', kind(1000, 30), null);
eq('0 retirados en 1.500 → clasificador ciego', kind(1500, 0), 'blind');
eq('0,5% en 1.000 → clasificador ciego', kind(1000, 5), 'blind');
eq('muestra chica (100) con 0 → no alerta', kind(100, 0), null);
eq('0 verificados → barrido muerto', kind(0, 0), 'stalled');
eq('mensaje nombra el portal', evaluateSweepHealth({ portal: 'metrocuadrado', checked: 0, gone: 0 })?.message.includes('metrocuadrado'), true);

if (failures > 0) {
  console.log(`\n❌ ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ sweep health OK');
