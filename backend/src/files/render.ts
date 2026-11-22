import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

/** Render teks Markdown sederhana (judul #, paragraf, **tebal**) menjadi PDF nyata. */
export function renderPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(11);
    for (const line of text.split(/\r?\n/)) {
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        doc.moveDown(0.5).font('Helvetica-Bold').fontSize(20 - (h[1].length - 1) * 3).text(h[2]);
        doc.font('Helvetica').fontSize(11);
      } else if (!line.trim()) {
        doc.moveDown(0.5);
      } else {
        doc.text(line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^[-*]\s+/, '• '));
      }
    }
    doc.end();
  });
}

function runs(line: string): TextRun[] {
  return line
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? new TextRun({ text: part.slice(2, -2), bold: true })
        : new TextRun(part),
    );
}

/** Render teks Markdown sederhana menjadi DOCX nyata. */
export async function renderDocx(text: string): Promise<Buffer> {
  const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const children = text.split(/\r?\n/).map((line) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) return new Paragraph({ heading: levels[h[1].length - 1], children: [new TextRun(h[2])] });
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (b) return new Paragraph({ bullet: { level: 0 }, children: runs(b[1]) });
    return new Paragraph({ children: runs(line) });
  });
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
