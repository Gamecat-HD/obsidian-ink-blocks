// Erzeugt test-vault/Arbeitsblatt.pdf: 2 Seiten A4 mit Aufgaben und Antwortlinien (für Arbeitsblatt-Tests).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const W = 595.28;
const H = 841.89;

function page(title, tasks) {
	const ops = ["BT /F1 20 Tf 56 780 Td (" + title + ") Tj ET"];
	let y = 730;
	for (const t of tasks) {
		ops.push(`BT /F1 12 Tf 56 ${y} Td (${t}) Tj ET`);
		for (let i = 1; i <= 2; i++) ops.push(`0.6 G 0.5 w 56 ${y - 28 * i} m 540 ${y - 28 * i} l S`);
		y -= 110;
	}
	return ops.join("\n");
}

const pages = [
	page("Arbeitsblatt IPv6", [
		"1. Kuerze die Adresse 2001:0db8:0000:0000:0000:0000:0000:0001",
		"2. Wie viele /64-Netze passen in ein /48?",
		"3. Nenne den Praefix fuer Link-Local-Adressen.",
		"4. Was ist die Loopback-Adresse in IPv6?",
	]),
	page("Arbeitsblatt Subnetting", [
		"1. Subnetzmaske fuer /26 in Dezimalschreibweise?",
		"2. Wie viele Hosts hat ein /27-Netz?",
	]),
];

const objs = [];
const add = (s) => objs.push(s) && objs.length;
const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
add(""); // Platzhalter Pages
const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const kids = [];
for (const content of pages) {
	const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
	kids.push(
		add(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${stream} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
		),
	);
}
objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

let out = "%PDF-1.4\n";
const offsets = [];
objs.forEach((o, i) => {
	offsets.push(Buffer.byteLength(out));
	out += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const target = resolve(import.meta.dirname, "../test-vault/Arbeitsblatt.pdf");
writeFileSync(target, out, "latin1");
console.log(`geschrieben: ${target} (${out.length} Bytes)`);
