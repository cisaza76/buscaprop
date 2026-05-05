// lib/certificates/repository.ts
// Persistencia de certificados parseados + validación SNR.
//
// API principal: ingestCertificate(propertyId, pdfBuffer)
//   1. Parsea el PDF (extrae PIN, matrícula, NUPRE, anotaciones, gravámenes)
//   2. Calcula expiración (30 días desde impresión)
//   3. Llama best-effort a SNR (paralelo con persistencia para no bloquear)
//   4. Persiste en property_certificates + property_certificate_anotaciones
//   5. Retorna análisis completo

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  extractTextFromPDF,
  parseCertificateText,
  type ParsedCertificate,
} from './pdf-parser';
import { validateWithSNR, type SNRStatus } from './snr';

let cached: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface PropertyCertificate {
  id: string;
  property_id: string;
  pin: string;
  matricula: string;
  nupre: string | null;
  codigo_catastral: string | null;
  certificate_issued_at: string | null;
  certificate_expires_at: string | null;
  estado_folio: string | null;
  total_anotaciones: number | null;
  current_owner: string | null;
  current_owner_id: string | null;
  last_sale_date: string | null;
  last_sale_value_cop: number | null;
  has_active_liens: boolean;
  active_liens_count: number;
  active_liens_summary: string | null;
  snr_status: SNRStatus | 'pending' | 'valid';
  snr_validated_at: string | null;
  snr_error_message: string | null;
  uploaded_at: string;
}

export interface IngestResult {
  certificate: PropertyCertificate | null;
  parsed: ParsedCertificate;
  persisted: boolean;
  error_message?: string;
}

/**
 * Ingesta principal: parse + SNR + persist. Idempotente por (property, pin):
 * si se sube el mismo PDF dos veces, refresca el row existente.
 */
export async function ingestCertificate(
  propertyId: string,
  pdfBuffer: Buffer | Uint8Array
): Promise<IngestResult> {
  // 1. Parse PDF.
  const text = await extractTextFromPDF(pdfBuffer);
  const parsed = parseCertificateText(text);

  if (!parsed.pin || !parsed.matricula) {
    return {
      certificate: null,
      parsed,
      persisted: false,
      error_message: 'No pude extraer PIN o matrícula del PDF — ¿es un certificado SNR oficial?',
    };
  }

  // 2. Calcular expiración (30 días desde impresión).
  let expiresAt: string | null = null;
  if (parsed.certificate_issued_at) {
    const issued = new Date(parsed.certificate_issued_at);
    expiresAt = new Date(issued.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  // 3. SNR validation (best-effort, en paralelo con la preparación del row).
  const snrPromise = validateWithSNR(parsed.pin, parsed.certificate_issued_at);

  // 4. Esperar SNR.
  const snr = await snrPromise;

  // 5. Persist.
  const sb = getClient();
  const certRow = {
    property_id: propertyId,
    pin: parsed.pin,
    matricula: parsed.matricula,
    nupre: parsed.nupre,
    codigo_catastral: parsed.codigo_catastral,
    certificate_issued_at: parsed.certificate_issued_at,
    certificate_expires_at: expiresAt,
    estado_folio: parsed.estado_folio,
    total_anotaciones: parsed.total_anotaciones,
    current_owner: parsed.current_owner,
    current_owner_id: parsed.current_owner_id,
    last_sale_date: parsed.last_sale_date,
    last_sale_value_cop: parsed.last_sale_value_cop,
    has_active_liens: parsed.has_active_liens,
    active_liens_count: parsed.active_liens_count,
    active_liens_summary: parsed.active_liens_summary,
    snr_status: snr.status,
    snr_validated_at: new Date().toISOString(),
    snr_error_message: snr.error_message ?? null,
  };

  // Buscar row existente por (property_id, pin).
  const { data: existing } = await sb
    .from('property_certificates')
    .select('id')
    .eq('property_id', propertyId)
    .eq('pin', parsed.pin)
    .maybeSingle();

  let certId: string;
  if (existing?.id) {
    const { error: updErr } = await sb
      .from('property_certificates')
      .update({ ...certRow, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (updErr) {
      const msg = updErr.message ?? '';
      if (isMissingTable(msg)) {
        return {
          certificate: null,
          parsed,
          persisted: false,
          error_message:
            'Tabla property_certificates no existe. Aplicar migration 011.',
        };
      }
      return { certificate: null, parsed, persisted: false, error_message: msg };
    }
    certId = existing.id as string;
    // Borrar anotaciones viejas para re-insertar con el parser actual.
    await sb
      .from('property_certificate_anotaciones')
      .delete()
      .eq('certificate_id', certId);
  } else {
    const { data: inserted, error: insErr } = await sb
      .from('property_certificates')
      .insert(certRow)
      .select('id')
      .single();
    if (insErr || !inserted) {
      const msg = insErr?.message ?? '';
      if (isMissingTable(msg)) {
        return {
          certificate: null,
          parsed,
          persisted: false,
          error_message:
            'Tabla property_certificates no existe. Aplicar migration 011.',
        };
      }
      return { certificate: null, parsed, persisted: false, error_message: msg };
    }
    certId = inserted.id as string;
  }

  // Insertar anotaciones (si las hay y la tabla existe).
  if (parsed.anotaciones.length > 0) {
    const rows = parsed.anotaciones.map((a) => ({
      certificate_id: certId,
      numero: a.numero,
      fecha: a.fecha,
      radicacion: a.radicacion,
      documento: a.documento,
      valor_acto_cop: a.valor_acto_cop,
      especificacion: a.especificacion,
      categoria: a.categoria,
      cancela_anotacion_numero: a.cancela_anotacion_numero,
      is_cancelled: a.is_cancelled,
      texto_raw: a.texto_raw.length > 5000 ? a.texto_raw.slice(0, 5000) : a.texto_raw,
    }));
    const { error: anErr } = await sb
      .from('property_certificate_anotaciones')
      .insert(rows);
    if (anErr) {
      const msg = anErr.message ?? '';
      if (!isMissingTable(msg)) {
        console.warn(`[anotaciones] insert falló: ${msg}`);
      }
      // No bloqueamos — el certificate se persiste igual.
    }
  }

  // Releer el row para devolverlo completo.
  const { data: certData } = await sb
    .from('property_certificates')
    .select('*')
    .eq('id', certId)
    .single();
  return {
    certificate: (certData as PropertyCertificate | null) ?? null,
    parsed,
    persisted: true,
  };
}

/**
 * Lectura: el certificado más reciente de una propiedad. Null si no hay.
 */
export async function getLatestCertificate(
  propertyId: string
): Promise<PropertyCertificate | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from('property_certificates')
    .select('*')
    .eq('property_id', propertyId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message ?? '')) return null;
    throw new Error(`getLatestCertificate failed: ${error.message}`);
  }
  return (data as PropertyCertificate | null) ?? null;
}

/**
 * Lectura: anotaciones de un certificado.
 */
export async function getCertificateAnotaciones(certificateId: string) {
  const sb = getClient();
  const { data, error } = await sb
    .from('property_certificate_anotaciones')
    .select('*')
    .eq('certificate_id', certificateId)
    .order('numero', { ascending: true });
  if (error) {
    if (isMissingTable(error.message ?? '')) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

function isMissingTable(msg: string): boolean {
  return /does not exist/i.test(msg) || /could not find.*(table|column)/i.test(msg);
}
