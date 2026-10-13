const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function shortId(length = 4, random: () => number = Math.random): string {
	let id = "";
	for (let i = 0; i < length; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
	return id;
}

const TRANSLITERATION: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Dateinamen-tauglicher Slug: klein, Umlaute ausgeschrieben, nur [a-z0-9-]. */
export function slugify(name: string, maxLength = 40): string {
	return name
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => TRANSLITERATION[c])
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/-+$/g, "");
}

function isoDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `<YYYY-MM-DD>-<slug>-<id>.ink` (lokales Datum). */
export function inkFileName(date: Date, noteBasename: string, id: string): string {
	return `${isoDate(date)}-${slugify(noteBasename) || "notiz"}-${id}.ink`;
}
