/**
 * Markdown → Klartextzeilen für das Sprachmodell. Code bleibt erhalten (IT-Notizen), entfernt werden
 * Frontmatter, ink-Blöcke (deren `text:` stammt aus der OCR selbst und würde Fehler verstärken),
 * Link-Ziele, URLs, HTML und Markdown-Syntax.
 */
export function markdownToCorpus(md: string): string[] {
	let s = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
	s = s.replace(/^(`{3,}|~{3,})\s*ink\b[\s\S]*?^\1\s*$/gm, "");
	s = s.replace(/^(`{3,}|~{3,}).*$/gm, "");
	s = s
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>\n]+>/g, " ")
		.replace(/\bhttps?:\/\/\S+/g, " ")
		.replace(/%%[\s\S]*?%%/g, " ")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+\[.\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, "")
		.replace(/(\*\*|__|==|~~|`)/g, "")
		.replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")
		.replace(/\|/g, " ")
		.replace(/^\s*:?-{3,}:?\s*$/gm, "");
	return s
		.split(/\r?\n/)
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter((l) => l.length > 1);
}
