// Quick smoke: read PDF, extract text, run regex.
import fs from 'fs';

async function main() {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument: (args: { data: Uint8Array; useSystemFonts?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: { str: string }[] }>;
        }>;
      }>;
    };
  };
  const { getDocument } = pdfjs;
  const file = process.argv[2];
  if (!file) {
    console.log('usage: tsx scripts/test-pdfjs.ts <path-to-pdf>');
    process.exit(1);
  }
  const buf = fs.readFileSync(file);
  const data = new Uint8Array(buf);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items as { str: string }[])
      .map((it) => it.str)
      .join(' ');
    text += pageText + '\n\n';
  }
  console.log('pages:', doc.numPages);
  console.log('total text:', text.length, 'chars');
  console.log('--- sample regex extracts ---');
  const pin = text.match(/Pin No: (\d+)/);
  const mat = text.match(/Nro Matrícula: ([\w-]+)/);
  const nupre = text.match(/NUPRE: ([A-Z0-9]+)/);
  const cat = text.match(/CODIGO CATASTRAL: (\d+)/);
  const total = text.match(/NRO TOTAL DE ANOTACIONES: \*(\d+)\*/);
  const estado = text.match(/ESTADO DEL FOLIO:\s*(\w+)/);
  const impreso = text.match(/Impreso el (\d{1,2} de \w+ de \d{4} a las \d{2}:\d{2}:\d{2}\s*(?:AM|PM)?)/);
  console.log('PIN:', pin?.[1]);
  console.log('Matricula:', mat?.[1]);
  console.log('NUPRE:', nupre?.[1]);
  console.log('Catastral:', cat?.[1]);
  console.log('Total anotaciones:', total?.[1]);
  console.log('Estado folio:', estado?.[1]);
  console.log('Impreso:', impreso?.[1]);

  // Buscar anotaciones — pattern típico
  const anotaciones = [
    ...text.matchAll(/ANOTACION:\s*Nro\s*(\d+)\s+Fecha:\s*(\d{2}-\d{2}-\d{4})\s+Radicación:\s*([\w-]+)/g),
  ];
  console.log('\nanotaciones encontradas:', anotaciones.length);
  for (const a of anotaciones.slice(0, 5)) {
    console.log(`  Nro ${a[1]} · ${a[2]} · ${a[3]}`);
  }
}
main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
