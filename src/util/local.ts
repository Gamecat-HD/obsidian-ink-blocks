/** Einstellungen je Gerät in `localStorage` (wird nicht synchronisiert). Gesperrter Speicher ist kein Fehler. */

export function readLocal(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeLocal(key: string, value: string | null) {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, value);
	} catch {
		// Speicher gesperrt: gilt dann eben nur für diese Sitzung nicht.
	}
}
