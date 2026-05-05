// lib/certificates/pdf-parser.ts
// Parser de Certificados de Tradición y Libertad emitidos por SNR (Colombia).
// Extrae header (PIN, matrícula, NUPRE, etc.), 16+ anotaciones, y computa
// estado actual (propietario, último valor, gravámenes vigentes).
//
// El PDF es texto plano — extraemos con pdfjs-dist y aplicamos regex sobre
// el texto resultante. Validado contra cert real 50C-542649 (Phase 10 probe).

// pdfjs-dist no tiene types limpios para el legacy build; usamos any internal.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CertificateAnotacion {
  numero: number;
  fecha: string | null; // ISO date YYYY-MM-DD
  radicacion: string | null;
  documento: string | null;
  valor_acto_cop: number | null;
  especificacion: string | null;
  categoria: AnotacionCategoria;
  cancela_anotacion_numero: number | null;
  is_cancelled: boolean;
  texto_raw: string;
}

export type AnotacionCategoria =
  | 'compraventa'
  | 'gravamen'
  | 'cancelacion'
  | 'embargo'
  | 'hipoteca'
  | 'sucesion'
  | 'aporte'
  | 'cambio_razon_social'
  | 'falsa_tradicion'
  | 'medida_cautelar'
  | 'otro';

export interface ParsedCertificate {
  // Header
  pin: string | null;
  matricula: string | null;
  nupre: string | null;
  codigo_catastral: string | null;
  estado_folio: string | null;
  total_anotaciones: number | null;
  certificate_issued_at: string | null; // ISO timestamp
  // Anotaciones
  anotaciones: CertificateAnotacion[];
  // Análisis
  current_owner: string | null;
  current_owner_id: string | null; // CC# o NIT#
  last_sale_date: string | null; // ISO YYYY-MM-DD
  last_sale_value_cop: number | null;
  has_active_liens: boolean;
  active_liens_count: number;
  active_liens_summary: string | null;
  // Raw text — útil para debugging (no se persiste por default).
  raw_text?: string;
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/**
 * Extrae el texto de un PDF usando pdfjs-dist (legacy build, server-safe).
 */
export async function extractTextFromPDF(pdfBuffer: Buffer | Uint8Array): Promise<string> {
  // Dynamic import del legacy build (Node.js compatible, sin worker).
  const data = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer;
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items as { str: string }[])
      .map((it) => it.str)
      .join(' ');
    text += pageText + '\n\n';
  }
  return text;
}

/**
 * Parsea el texto extraído de un certificado SNR.
 */
export function parseCertificateText(text: string): ParsedCertificate {
  const result: ParsedCertificate = {
    pin: null,
    matricula: null,
    nupre: null,
    codigo_catastral: null,
    estado_folio: null,
    total_anotaciones: null,
    certificate_issued_at: null,
    anotaciones: [],
    current_owner: null,
    current_owner_id: null,
    last_sale_date: null,
    last_sale_value_cop: null,
    has_active_liens: false,
    active_liens_count: 0,
    active_liens_summary: null,
  };

  // ─── HEADER ─────────────────────────────────────────────────────────────
  const pin = text.match(/Pin No:\s*(\d{15,25})/);
  if (pin) result.pin = pin[1];

  const mat = text.match(/Nro Matrícula:\s*([\dA-Z]+-\d+)/);
  if (mat) result.matricula = mat[1];

  const nupre = text.match(/NUPRE:\s*([A-Z0-9]+)/);
  if (nupre) result.nupre = nupre[1];

  // Código catastral: número largo después de "CODIGO CATASTRAL:". OJO: el
  // PDF concatena con "COD CATASTRAL ANT" — cortamos por longitud.
  const cat = text.match(/CODIGO CATASTRAL:\s*(\d{10,30})/);
  if (cat) {
    // El número real en Bogotá es 18 dígitos. Si es más largo, truncamos.
    const num = cat[1];
    result.codigo_catastral = num.length > 18 ? num.slice(0, 18) : num;
  }

  const estado = text.match(/ESTADO DEL FOLIO:\s*(ACTIVO|CERRADO|\w+)/);
  if (estado) result.estado_folio = estado[1].toUpperCase();

  const total = text.match(/NRO TOTAL DE ANOTACIONES:\s*\*(\d+)\*/);
  if (total) result.total_anotaciones = parseInt(total[1], 10);

  const impreso = text.match(
    /Impreso el (\d{1,2}) de (\w+) de (\d{4}) a las (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i
  );
  if (impreso) {
    const day = parseInt(impreso[1], 10);
    const monthName = impreso[2].toLowerCase();
    const year = parseInt(impreso[3], 10);
    let hour = parseInt(impreso[4], 10);
    const min = parseInt(impreso[5], 10);
    const sec = parseInt(impreso[6], 10);
    const ampm = impreso[7]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const monthNum = SPANISH_MONTHS[monthName];
    if (monthNum) {
      // Bogotá local time = UTC-5. ISO con offset.
      const isoLocal = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}-05:00`;
      result.certificate_issued_at = isoLocal;
    }
  }

  // ─── ANOTACIONES ─────────────────────────────────────────────────────────
  // Strategy: split text en bloques que empiezan con "ANOTACION: Nro NNN".
  // Para cada bloque, parsear los campos y categorizar.
  const blocks = splitAnotaciones(text);
  for (const block of blocks) {
    const an = parseAnotacionBlock(block);
    if (an) result.anotaciones.push(an);
  }

  // Marcar las anotaciones que fueron canceladas por una posterior.
  for (const an of result.anotaciones) {
    if (an.cancela_anotacion_numero != null) {
      const target = result.anotaciones.find(
        (a) => a.numero === an.cancela_anotacion_numero
      );
      if (target) target.is_cancelled = true;
    }
  }

  // ─── ANÁLISIS ────────────────────────────────────────────────────────────
  // Vigencia del cert: 30 días desde impresión.
  if (result.certificate_issued_at) {
    const issued = new Date(result.certificate_issued_at);
    const expires = new Date(issued.getTime() + 30 * 24 * 60 * 60 * 1000);
    // (no field para guardar — el caller puede calcularlo)
  }

  // Último propietario actual (compraventa más reciente NO cancelada).
  const compraventas = result.anotaciones
    .filter((a) => a.categoria === 'compraventa')
    .filter((a) => !a.is_cancelled)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  if (compraventas.length > 0) {
    const last = compraventas[0];
    result.last_sale_date = last.fecha;
    result.last_sale_value_cop = last.valor_acto_cop;
    // Extraer "A: NOMBRE [CC#|NIT#] X" del texto raw — donde X es titular.
    const ownerMatch = last.texto_raw.match(
      /A:\s*([^\n]+?)(?:\s+(?:CC#|NIT#|NIT\.?\s*|CC\.?\s*)(\d[\d.,-]*)?)?\s+X\b/
    );
    if (ownerMatch) {
      result.current_owner = ownerMatch[1].trim().replace(/\s{2,}/g, ' ');
      if (ownerMatch[2]) result.current_owner_id = ownerMatch[2].replace(/[.,]/g, '');
    } else {
      // Fallback: buscar después de "A:" hasta el final de línea.
      const fallback = last.texto_raw.match(/A:\s*([^\n]{2,80})/);
      if (fallback) result.current_owner = fallback[1].trim();
    }
  }

  // Gravámenes activos: anotaciones tipo gravamen/embargo/hipoteca NO canceladas.
  const activeLiens = result.anotaciones.filter(
    (a) =>
      (a.categoria === 'gravamen' ||
        a.categoria === 'embargo' ||
        a.categoria === 'hipoteca' ||
        a.categoria === 'medida_cautelar') &&
      !a.is_cancelled
  );
  result.active_liens_count = activeLiens.length;
  result.has_active_liens = activeLiens.length > 0;
  if (activeLiens.length > 0) {
    result.active_liens_summary = activeLiens
      .map(
        (a) =>
          `Anotación ${a.numero} (${a.fecha ?? '?'}): ${a.especificacion ?? a.documento ?? '?'}`
      )
      .join(' · ');
  }

  return result;
}

// ============================================================================
// Internals
// ============================================================================

function splitAnotaciones(text: string): string[] {
  // Cada bloque empieza con "ANOTACION: Nro NNN" y termina antes del siguiente
  // o antes de "NRO TOTAL DE ANOTACIONES" / "SALVEDADES" / "FIN DE ESTE".
  const re = /ANOTACION:\s*Nro\s*\d+[\s\S]*?(?=ANOTACION:\s*Nro\s*\d+|NRO TOTAL DE ANOTACIONES|SALVEDADES|FIN DE ESTE|$)/g;
  return text.match(re) ?? [];
}

function parseAnotacionBlock(block: string): CertificateAnotacion | null {
  const headerMatch = block.match(
    /ANOTACION:\s*Nro\s*(\d+)\s+Fecha:\s*(\d{2}-\d{2}-\d{4})\s+Radicación:\s*([\w-]+)/
  );
  if (!headerMatch) return null;
  const numero = parseInt(headerMatch[1], 10);
  const fechaRaw = headerMatch[2];
  // Convert "DD-MM-YYYY" → "YYYY-MM-DD"
  const [d, m, y] = fechaRaw.split('-');
  const fecha = `${y}-${m}-${d}`;
  const radicacion = headerMatch[3];

  const docMatch = block.match(/Doc:\s*([^\n]+?)\s+VALOR ACTO:\s*\$([\d.,]*)?/);
  let documento: string | null = null;
  let valorCop: number | null = null;
  if (docMatch) {
    documento = docMatch[1].trim().replace(/\s{2,}/g, ' ');
    const valorStr = docMatch[2]?.replace(/[.,]/g, '');
    if (valorStr && valorStr.length > 0) {
      const v = parseInt(valorStr, 10);
      if (Number.isFinite(v) && v > 0) valorCop = v;
    }
  }

  const especMatch = block.match(/ESPECIFICACION:\s*([^\n]{1,200})/);
  const especificacion = especMatch ? especMatch[1].trim() : null;

  // Detectar "Se cancela anotación No: N"
  const cancelaMatch = block.match(/Se cancela anotación No:\s*(\d+)/);
  const cancela_anotacion_numero = cancelaMatch ? parseInt(cancelaMatch[1], 10) : null;

  // Categorización por keywords en especificacion + documento.
  const categoria = categorizeAnotacion(especificacion, documento);

  return {
    numero,
    fecha,
    radicacion,
    documento,
    valor_acto_cop: valorCop,
    especificacion,
    categoria,
    cancela_anotacion_numero,
    is_cancelled: false, // se recomputa después
    texto_raw: block.trim(),
  };
}

function categorizeAnotacion(
  esp: string | null,
  doc: string | null
): AnotacionCategoria {
  const t = `${esp ?? ''} ${doc ?? ''}`.toLowerCase();
  if (/cancelacion/.test(t)) return 'cancelacion';
  if (/embargo/.test(t)) return 'embargo';
  if (/hipoteca/.test(t)) return 'hipoteca';
  if (/medida cautelar/.test(t)) return 'medida_cautelar';
  if (/falsa tradici/.test(t)) return 'falsa_tradicion';
  if (/sucesion|adjudicacion en sucesion/.test(t)) return 'sucesion';
  if (/aporte/.test(t)) return 'aporte';
  if (/compraventa|compra venta/.test(t)) return 'compraventa';
  if (/cambio de razon social/.test(t)) return 'cambio_razon_social';
  if (/gravamen|valorizacion|plusvalia/.test(t)) return 'gravamen';
  return 'otro';
}
