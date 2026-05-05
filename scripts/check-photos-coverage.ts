import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: props } = await sb.from("properties").select("id, photos, source_portal").limit(50);
  let withPhotos = 0, with2Plus = 0;
  const portalCounts: Record<string, number> = {};
  for (const p of props ?? []) {
    const photos = (p.photos ?? []) as unknown[];
    if (photos.length > 0) withPhotos++;
    if (photos.length >= 2) with2Plus++;
    portalCounts[p.source_portal] = (portalCounts[p.source_portal] ?? 0) + photos.length;
  }
  console.log("Sample 50:");
  console.log(`  con fotos: ${withPhotos}`);
  console.log(`  con 2+ fotos: ${with2Plus}`);
  console.log(`  total fotos por portal:`, portalCounts);
  // Buscar las primeras 3 con 1+ foto.
  const some = (props ?? []).filter(p => (p.photos as unknown[]).length > 0).slice(0, 3);
  for (const p of some) {
    console.log(`  ${p.id} (${p.source_portal}): ${(p.photos as string[]).length} fotos`);
    console.log(`    sample url: ${(p.photos as string[])[0]?.slice(0, 80)}...`);
  }
}
main();
