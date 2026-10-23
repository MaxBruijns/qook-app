// Boodschappenlijst als PDF, zonder extra bibliotheken.
//
// Een eenvoudige PDF (A4, standaardlettertype Helvetica) met per afdeling vakjes om af te
// vinken. Werkt in elke browser en is ook te printen.
// Tekens buiten Latin-1 die in de PDF-codering (WinAnsi) een eigen plek hebben.
const WIN_ANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93,
    '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
/** Tekst naar één-byte-tekens (WinAnsi) en veilig binnen ( ) in een PDF. */
const pdfText = (s) => {
    let out = '';
    for (const ch of s.normalize('NFC')) {
        const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
        const c = code <= 0xff ? String.fromCharCode(code) : '?';
        out += c === '\\' || c === '(' || c === ')' ? `\\${c}` : c;
    }
    return out;
};
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
export function shoppingListPdf(title, subtitle, sections) {
    const W = 595, H = 842, M = 50, BOTTOM = 60;
    const pages = [];
    let ops = [];
    let y = H - M;
    const text = (x, yy, size, s, bold = false, rgb = '0.165 0.2 0.22') => ops.push(`${rgb} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${pdfText(s)}) Tj ET`);
    const newPage = () => { pages.push(ops.join('\n')); ops = []; y = H - M; };
    const need = (h) => { if (y - h < BOTTOM)
        newPage(); };
    text(M, y - 22, 22, title, true);
    y -= 34;
    text(M, y - 10, 10, subtitle, false, '0.36 0.43 0.46');
    y -= 30;
    for (const sec of sections) {
        need(40);
        text(M, y - 10, 9, sec.title.toUpperCase(), true, '0.37 0.54 0.41');
        y -= 20;
        for (const it of sec.items) {
            need(20);
            const grey = it.checked ? '0.6 0.65 0.67' : '0.165 0.2 0.22';
            ops.push(`0.72 0.78 0.74 RG 0.8 w ${M} ${y - 10} 10 10 re S`);
            if (it.checked)
                ops.push(`0.58 0.72 0.62 rg ${M + 2} ${y - 8} 6 6 re f`);
            text(M + 20, y - 9, 11, clip(it.name, 58), false, grey);
            if (it.amount)
                text(W - M - 130, y - 9, 11, clip(it.amount, 22), false, '0.36 0.43 0.46');
            y -= 19;
        }
        ops.push(`0.86 0.89 0.87 RG 0.5 w ${M} ${y - 2} m ${W - M} ${y - 2} l S`);
        y -= 14;
    }
    pages.push(ops.join('\n'));
    // Objecten: 1 catalogus, 2 paginalijst, 3-4 lettertypen, daarna per pagina: pagina + inhoud.
    const objs = [];
    const pageIds = pages.map((_, i) => 5 + i * 2);
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((content, i) => {
        const id = pageIds[i];
        objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
        objs[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
        offsets[i] = pdf.length;
        pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++)
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++)
        bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
}
/** PDF laten downloaden (werkt ook op de telefoon: openen, delen of bewaren). */
export function downloadPdf(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
