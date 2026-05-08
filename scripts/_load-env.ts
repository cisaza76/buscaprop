// scripts/_load-env.ts
// Side-effect-only import. Cargá esto PRIMERO (con `import './_load-env';`)
// en cualquier script que importe módulos que validan envs en module load
// (ej. lib/supabase.ts → throws si NEXT_PUBLIC_SUPABASE_URL falta).
//
// ESM hoistea los imports al top del archivo, así que un `config({...})`
// inline después del import no funciona — el import del módulo problemático
// ya se evaluó. Este helper se ejecuta como side-effect del import statement.
import { config } from 'dotenv';
config({ path: '.env.local' });
