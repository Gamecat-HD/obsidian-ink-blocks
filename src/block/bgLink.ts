/**
 * `bg:`-Wert eines ink-Blocks → Linkpfad + Seite.
 * Unterstützt: `[[X.pdf#page=2]]`, `![[X.pdf#page=2|Alias]]`, `[[X.pdf]]#page=2`, `X.pdf#page=2`, `bild.png`.
 */
export interface BgLink {
	linkpath: string;
	page?: number;
}

export function parseBgLink(value: string | undefined): BgLink | null {
	let v = (value ?? "").trim();
	if (!v) return null;
	let outside = "";
	const m = /^!?\[\[(.*?)\]\](.*)$/.exec(v);
	if (m) {
		v = m[1];
		outside = m[2].trim();
	}
	v = v.split("|")[0].trim();
	const hash = v.indexOf("#");
	const linkpath = (hash >= 0 ? v.slice(0, hash) : v).trim();
	const subpath = (hash >= 0 ? v.slice(hash) : "") + outside;
	if (!linkpath) return null;
	const page = /#page=(\d+)/.exec(subpath)?.[1];
	return page ? { linkpath, page: Math.max(1, Number(page)) } : { linkpath };
}

export function formatBgLink(linktext: string, page?: number): string {
	return `[[${linktext}${page ? `#page=${page}` : ""}]]`;
}

/** Zeigt `linkpath` (wie in einer Notiz geschrieben) auf die Datei `filePath`? Ohne Vault-Auflösung. */
export function linkMatchesPath(linkpath: string, filePath: string): boolean {
	const lp = linkpath.replace(/^\/+/, "");
	if (lp === filePath) return true;
	return filePath.endsWith("/" + lp);
}
