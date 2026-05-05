// app/api/property/[id]/certificate/validate/route.ts
// POST: subir un PDF de Certificado de Tradición y validarlo.
//
// Body (JSON): { pdf_base64: string }
// Response: { ok, certificate, parsed, persisted, error_message? }
//
// Uso desde el browser: convertir el File a base64 con FileReader.
// Tamaño max razonable: 5 MB de PDF (después del base64 ≈ 7 MB de body).
//
// SEGURIDAD: este endpoint no tiene auth de role hoy. En producción debería
// requerir que el caller sea un agente dueño de la propiedad. Para MVP,
// rate limit por IP + property_id.

import { NextResponse, type NextRequest } from 'next/server';
import { ingestCertificate } from '@/lib/certificates/repository';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'id debe ser UUID' }, { status: 400 });
  }

  let body: { pdf_base64?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body debe ser JSON' }, { status: 400 });
  }

  if (!body.pdf_base64 || typeof body.pdf_base64 !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'pdf_base64 es requerido (string base64).' },
      { status: 400 }
    );
  }

  // Decodificar base64.
  let pdfBuffer: Buffer;
  try {
    // Aceptar data URL ("data:application/pdf;base64,...") o base64 puro.
    const cleaned = body.pdf_base64.replace(/^data:[^,]+,/, '');
    pdfBuffer = Buffer.from(cleaned, 'base64');
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'pdf_base64 inválido: ' + (err instanceof Error ? err.message : err) },
      { status: 400 }
    );
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `PDF excede ${MAX_PDF_BYTES / 1024 / 1024} MB (recibido ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB).`,
      },
      { status: 413 }
    );
  }

  // Sanity: empieza con "%PDF"?
  if (
    pdfBuffer.length < 5 ||
    pdfBuffer[0] !== 0x25 ||
    pdfBuffer[1] !== 0x50 ||
    pdfBuffer[2] !== 0x44 ||
    pdfBuffer[3] !== 0x46
  ) {
    return NextResponse.json(
      { ok: false, error: 'El archivo no parece un PDF (falta header %PDF).' },
      { status: 400 }
    );
  }

  try {
    const result = await ingestCertificate(id, pdfBuffer);
    if (!result.parsed.pin) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.error_message ??
            'No pude extraer datos del PDF — verificá que sea un Certificado de Tradición de SNR.',
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[/api/property/[id]/certificate/validate]', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Error procesando certificado.',
      },
      { status: 500 }
    );
  }
}

// GET: leer el certificado más reciente de una propiedad.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'id debe ser UUID' }, { status: 400 });
  }

  try {
    const { getLatestCertificate, getCertificateAnotaciones } = await import(
      '@/lib/certificates/repository'
    );
    const cert = await getLatestCertificate(id);
    if (!cert) {
      return NextResponse.json(
        { ok: false, error: 'Sin certificado subido para esta propiedad.' },
        { status: 404 }
      );
    }
    const anotaciones = await getCertificateAnotaciones(cert.id);
    return NextResponse.json({
      ok: true,
      certificate: cert,
      anotaciones,
    });
  } catch (err) {
    console.error('[GET certificate]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error' },
      { status: 500 }
    );
  }
}
