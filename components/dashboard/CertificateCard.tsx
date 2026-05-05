// components/dashboard/CertificateCard.tsx
// Card de Certificado de Tradición. Dos modos:
//  - Si existe certificado subido → muestra resumen + anotaciones recientes
//  - Si no existe → muestra widget de upload (drag-drop PDF)
//
// La upload llama a POST /api/property/{id}/certificate/validate y refresca.

'use client';

import { useEffect, useRef, useState } from 'react';

interface Anotacion {
  numero: number;
  fecha: string | null;
  categoria: string | null;
  especificacion: string | null;
  valor_acto_cop: number | null;
  is_cancelled: boolean;
}

interface CertificateData {
  id: string;
  pin: string;
  matricula: string;
  nupre: string | null;
  codigo_catastral: string | null;
  estado_folio: string | null;
  total_anotaciones: number | null;
  certificate_issued_at: string | null;
  certificate_expires_at: string | null;
  current_owner: string | null;
  current_owner_id: string | null;
  last_sale_date: string | null;
  last_sale_value_cop: number | null;
  has_active_liens: boolean;
  active_liens_count: number;
  active_liens_summary: string | null;
  snr_status:
    | 'pending'
    | 'received'
    | 'valid'
    | 'invalid'
    | 'expired'
    | 'error';
  snr_validated_at: string | null;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  certificate?: CertificateData;
  anotaciones?: Anotacion[];
}

const SNR_LABELS: Record<CertificateData['snr_status'], { label: string; color: string }> = {
  valid: { label: '✓ Validado en SNR', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  received: {
    label: '◐ Recibido por SNR',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  pending: {
    label: 'Pendiente de validar',
    color: 'bg-gray-50 text-gray-700 border-gray-200',
  },
  expired: {
    label: '⏱ Certificado vencido (>30 días)',
    color: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  invalid: {
    label: '✗ Rechazado por SNR',
    color: 'bg-red-50 text-red-800 border-red-200',
  },
  error: {
    label: 'Validación no completada',
    color: 'bg-gray-50 text-gray-600 border-gray-200',
  },
};

const CATEGORIA_LABELS: Record<string, string> = {
  compraventa: 'Compraventa',
  gravamen: 'Gravamen',
  cancelacion: 'Cancelación',
  embargo: 'Embargo',
  hipoteca: 'Hipoteca',
  sucesion: 'Sucesión',
  aporte: 'Aporte',
  cambio_razon_social: 'Cambio razón social',
  falsa_tradicion: 'Falsa tradición',
  medida_cautelar: 'Medida cautelar',
  otro: 'Otro',
};

export function CertificateCard({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<CertificateData | null>(null);
  const [anotaciones, setAnotaciones] = useState<Anotacion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/property/${propertyId}/certificate/validate`);
      if (res.status === 404) {
        setData(null);
        setAnotaciones([]);
      } else if (res.ok) {
        const json = (await res.json()) as ApiResponse;
        setData(json.certificate ?? null);
        setAnotaciones(json.anotaciones ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  if (isLoading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="h-5 w-56 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-4 w-full bg-gray-50 rounded animate-pulse" />
      </section>
    );
  }

  if (!data) {
    return (
      <CertificateUploadWidget
        propertyId={propertyId}
        isUploading={isUploading}
        setIsUploading={setIsUploading}
        uploadError={uploadError}
        setUploadError={setUploadError}
        onUploaded={refresh}
      />
    );
  }

  return (
    <CertificateSummary
      cert={data}
      anotaciones={anotaciones}
      onReupload={refresh}
      isUploading={isUploading}
      setIsUploading={setIsUploading}
      uploadError={uploadError}
      setUploadError={setUploadError}
      propertyId={propertyId}
    />
  );
}

// ============================================================================
// Upload widget (sin certificado aún)
// ============================================================================

function CertificateUploadWidget({
  propertyId,
  isUploading,
  setIsUploading,
  uploadError,
  setUploadError,
  onUploaded,
}: {
  propertyId: string;
  isUploading: boolean;
  setIsUploading: (v: boolean) => void;
  uploadError: string | null;
  setUploadError: (v: string | null) => void;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Solo se aceptan archivos PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('PDF excede 5 MB.');
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')
      );
      const res = await fetch(`/api/property/${propertyId}/certificate/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json.error ?? `HTTP ${res.status}`);
      } else {
        onUploaded();
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Error al subir');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section
      className={`bg-white border-2 border-dashed rounded-xl p-6 transition-colors ${
        isDragging ? 'border-teal-400 bg-teal-50/30' : 'border-gray-300'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          📄
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-gray-900">
            Certificado de Tradición y Libertad
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Si sos el agente de esta propiedad, subí el certificado oficial de
            SNR (PDF). Extraemos automáticamente: matrícula, propietario actual,
            historial, gravámenes vigentes, y validamos contra SuperNotariado.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
        >
          {isUploading ? 'Procesando…' : 'Subir PDF'}
        </button>
        <span className="text-xs text-gray-500">o arrastrá el archivo acá</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            // Limpiar para permitir resubir el mismo archivo.
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </div>

      {uploadError && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
          ⚠️ {uploadError}
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Sólo se procesa el texto del PDF. No guardamos el archivo.
      </p>
    </section>
  );
}

// ============================================================================
// Summary (con certificado subido)
// ============================================================================

function CertificateSummary({
  cert,
  anotaciones,
  propertyId,
  onReupload,
  isUploading,
  setIsUploading,
  uploadError,
  setUploadError,
}: {
  cert: CertificateData;
  anotaciones: Anotacion[];
  propertyId: string;
  onReupload: () => void;
  isUploading: boolean;
  setIsUploading: (v: boolean) => void;
  uploadError: string | null;
  setUploadError: (v: string | null) => void;
}) {
  const snrChip = SNR_LABELS[cert.snr_status];
  const isExpired = cert.certificate_expires_at
    ? new Date(cert.certificate_expires_at).getTime() < Date.now()
    : false;

  const formatCOP = (n: number | null) =>
    n != null ? `$${n.toLocaleString('es-CO')}` : '—';
  const formatDate = (s: string | null) =>
    s
      ? new Date(s).toLocaleDateString('es-CO', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—';

  // Activas (NO canceladas), ordenadas desc por fecha.
  const recent = anotaciones
    .filter((a) => !a.is_cancelled)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .slice(0, 4);

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Certificado de Tradición
        </h2>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full border ${snrChip.color}`}
        >
          {snrChip.label}
        </span>
      </div>

      {/* Bandera roja si hay gravámenes activos */}
      {cert.has_active_liens && cert.active_liens_summary && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm font-semibold text-red-900 mb-1">
            ⚠️ {cert.active_liens_count} gravamen
            {cert.active_liens_count === 1 ? '' : 'es'} vigente
            {cert.active_liens_count === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-red-800 leading-relaxed">
            {cert.active_liens_summary}
          </p>
        </div>
      )}

      {/* Datos básicos en grid */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="Matrícula" value={cert.matricula} mono />
        {cert.nupre && <Row label="NUPRE" value={cert.nupre} mono />}
        {cert.estado_folio && (
          <Row
            label="Estado del folio"
            value={
              <span
                className={
                  cert.estado_folio === 'ACTIVO'
                    ? 'text-emerald-700 font-medium'
                    : 'text-amber-700 font-medium'
                }
              >
                {cert.estado_folio}
              </span>
            }
          />
        )}
        {cert.total_anotaciones != null && (
          <Row label="Total anotaciones" value={cert.total_anotaciones} />
        )}
        {cert.current_owner && (
          <Row
            label="Propietario actual"
            value={
              <span title={cert.current_owner_id ?? undefined}>
                {cert.current_owner}
              </span>
            }
          />
        )}
        {cert.last_sale_value_cop && (
          <Row
            label="Última compraventa"
            value={
              <span>
                {formatCOP(cert.last_sale_value_cop)}
                <span className="text-xs text-gray-500 ml-1">
                  ({formatDate(cert.last_sale_date)})
                </span>
              </span>
            }
          />
        )}
        {cert.certificate_issued_at && (
          <Row
            label="Impreso"
            value={
              <span>
                {formatDate(cert.certificate_issued_at)}
                {isExpired && (
                  <span className="text-xs text-amber-700 ml-1">(vencido)</span>
                )}
              </span>
            }
          />
        )}
      </dl>

      {/* Anotaciones recientes */}
      {recent.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Últimas anotaciones (no canceladas)
          </p>
          <ul className="space-y-2">
            {recent.map((a) => (
              <li key={a.numero} className="text-sm">
                <span className="font-medium text-gray-900">
                  #{a.numero} · {formatDate(a.fecha)}
                </span>
                {a.categoria && (
                  <span className="ml-2 text-xs text-gray-600">
                    {CATEGORIA_LABELS[a.categoria] ?? a.categoria}
                  </span>
                )}
                {a.valor_acto_cop && (
                  <span className="ml-2 text-xs text-gray-700 font-mono">
                    {formatCOP(a.valor_acto_cop)}
                  </span>
                )}
                {a.especificacion && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {a.especificacion}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 leading-relaxed">
        ⓘ Datos extraídos del PDF subido. Para validar manualmente con SNR,{' '}
        <a
          href={`https://certificados.supernotariado.gov.co/certificado/external/validation/validate.snr`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-700 underline"
        >
          ingresá el PIN <code className="font-mono text-[11px]">{cert.pin}</code> en el
          portal oficial
        </a>
        .
      </p>

      {/* Re-upload */}
      <div className="mt-3 flex items-center justify-between">
        <ReuploadButton
          propertyId={propertyId}
          isUploading={isUploading}
          setIsUploading={setIsUploading}
          uploadError={uploadError}
          setUploadError={setUploadError}
          onUploaded={onReupload}
        />
        {uploadError && (
          <span className="text-xs text-red-700">⚠️ {uploadError}</span>
        )}
      </div>
    </section>
  );
}

function ReuploadButton(props: {
  propertyId: string;
  isUploading: boolean;
  setIsUploading: (v: boolean) => void;
  uploadError: string | null;
  setUploadError: (v: string | null) => void;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      props.setUploadError('PDF excede 5 MB.');
      return;
    }
    props.setUploadError(null);
    props.setIsUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')
      );
      const res = await fetch(
        `/api/property/${props.propertyId}/certificate/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdf_base64: base64 }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        props.setUploadError(json.error ?? `HTTP ${res.status}`);
      } else {
        props.onUploaded();
      }
    } catch (err) {
      props.setUploadError(err instanceof Error ? err.message : 'Error');
    } finally {
      props.setIsUploading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={props.isUploading}
        onClick={() => inputRef.current?.click()}
        className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50"
      >
        {props.isUploading ? 'Procesando…' : 'Subir certificado actualizado'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd
        className={`mt-0.5 text-gray-900 ${mono ? 'font-mono text-[13px]' : 'font-medium'}`}
      >
        {value}
      </dd>
    </div>
  );
}
