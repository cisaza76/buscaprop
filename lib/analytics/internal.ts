// lib/analytics/internal.ts
// Quién cuenta como tráfico interno en PostHog (is_internal=true). El filtro
// "internal and test users" del proyecto excluye estas personas por defecto,
// para que las pruebas del equipo no inflen el embudo.

// Cuentas del equipo, por id de auth.users (no son secretos).
const INTERNAL_USER_IDS = new Set<string>([
  'd7b42cc3-caa4-4d71-bdfa-738efca41ba8', // Camilo
  '8dcd62f7-3235-41a1-8418-bad324a93691', // QA registro atómico (TEST_ACCOUNT_EMAIL)
  '50049e88-651e-4806-9af3-4253e795ff85', // QA PostHog (TEST_ACCOUNT_2_EMAIL)
  '8c36f419-2c5f-45a4-b405-653bea17584b', // QA PostHog 2 (TEST_ACCOUNT_3_EMAIL)
]);
// El servidor (lead_created) solo tiene el id, no el correo: por eso las
// cuentas QA van también acá aunque su dominio ya las marque en el browser.

// Cuentas de prueba creadas por scripts/QA. El correo se evalúa acá y NUNCA
// se manda a PostHog: solo sale el booleano.
const INTERNAL_EMAIL_DOMAINS = ['@buscaprop.test'];

export function isInternalUser(user: { id: string; email?: string | null }): boolean {
  if (INTERNAL_USER_IDS.has(user.id)) return true;
  const email = user.email?.toLowerCase() ?? '';
  return INTERNAL_EMAIL_DOMAINS.some((d) => email.endsWith(d));
}
