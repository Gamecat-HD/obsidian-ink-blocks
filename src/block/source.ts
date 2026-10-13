/**
 * Inhalt eines ```ink-Blocks: einfache `key: value`-Zeilen plus `text: |` als eingerückter Block.
 *
 *   file: _ink/2026-10-13-notiz-a1b2.ink
 *   bg: "[[Arbeitsblatt.pdf]]#page=2"
 *   bgStyle: ruled
 *   text: |
 *     erkannter Text
 *
 * `setField` ändert genau ein Feld und lässt alle anderen Zeilen unverändert.
 */

export interface BlockFields {
	file?: string;
	bg?: string;
	bgStyle?: string;
	/** Linienabstand bzw. Kästchengröße (Doc-Einheiten); fehlt → Einstellungen. */
	gap?: string;
	text?: string;
	[key: string]: string | undefined;
}

const KEY_LINE = /^([A-Za-z][\w-]*):(?:\s(.*))?$/;
const TEXT_INDENT = "  ";

function unquote(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
		return v.slice(1, -1);
	}
	return v;
}

function splitLines(src: string): { lines: string[]; eol: string } {
	const eol = src.includes("\r\n") ? "\r\n" : "\n";
	return { lines: src.split(/\r?\n/), eol };
}

interface FieldSpan {
	key: string;
	start: number;
	/** exklusiv */
	end: number;
}

function fieldSpans(lines: string[]): FieldSpan[] {
	const spans: FieldSpan[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = KEY_LINE.exec(lines[i]);
		if (!m) continue;
		let end = i + 1;
		if ((m[2] ?? "").trim() === "|") {
			while (end < lines.length && (lines[end].startsWith(" ") || lines[end].trim() === "")) end++;
			// Leerzeilen am Ende gehören nicht mehr zum Block.
			while (end > i + 1 && lines[end - 1].trim() === "") end--;
		}
		spans.push({ key: m[1], start: i, end });
		i = end - 1;
	}
	return spans;
}

export function parseBlock(src: string): BlockFields {
	const { lines } = splitLines(src);
	const fields: BlockFields = {};
	for (const span of fieldSpans(lines)) {
		const value = KEY_LINE.exec(lines[span.start])?.[2] ?? "";
		if (value.trim() === "|") {
			fields[span.key] = lines
				.slice(span.start + 1, span.end)
				.map((l) => (l.startsWith(TEXT_INDENT) ? l.slice(TEXT_INDENT.length) : l.trimStart()))
				.join("\n");
		} else {
			fields[span.key] = unquote(value);
		}
	}
	return fields;
}

function formatField(key: string, value: string): string[] {
	if (key === "text" || value.includes("\n")) {
		return [`${key}: |`, ...value.split("\n").map((l) => (l ? TEXT_INDENT + l : ""))];
	}
	const needsQuotes = /^[\s"'[{]|[#:]\s|\s$/.test(value);
	return [`${key}: ${needsQuotes ? JSON.stringify(value) : value}`];
}

/** Mehrere Felder auf einmal (siehe `setField`). */
export function setFields(src: string, fields: Record<string, string | undefined>): string {
	return Object.entries(fields).reduce((out, [key, value]) => setField(out, key, value), src);
}

/** Setzt (oder entfernt bei `undefined`/leer) ein Feld; alle anderen Zeilen bleiben unverändert. */
export function setField(src: string, key: string, value: string | undefined): string {
	const split = splitLines(src);
	const { eol } = split;
	let lines = split.lines;
	// Ein abschließender Zeilenumbruch erzeugt ein leeres letztes Element – merken und erhalten.
	const trailing = lines.length > 1 && lines.at(-1) === "";
	if (trailing) lines.pop();
	if (lines.length === 1 && lines[0] === "") lines = [];

	const span = fieldSpans(lines).find((s) => s.key === key);
	const replacement = value === undefined || value === "" ? [] : formatField(key, value);
	if (span) lines.splice(span.start, span.end - span.start, ...replacement);
	else lines.push(...replacement);

	const out = lines.join(eol);
	return trailing ? out + eol : out;
}
