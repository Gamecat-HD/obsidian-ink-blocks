/** FNV-1a (32 bit) als 8-stelliger Hex-String – für Cache-Keys, nicht kryptografisch. */
export function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
