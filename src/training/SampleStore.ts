import { normalizePath, Platform, TFile } from "obsidian";
import type InkBlocksPlugin from "../main";
import { readLocal, writeLocal } from "../util/local";
import { shortId } from "../util/ids";
import { dedupeSamples, encodeSample, parseSamples, type TrainingSample } from "./samples";

const DEVICE_KEY = "ink-blocks-device-id";

/** Kennung dieses Geräts (je Gerät eine Datei → kein Sync-Konflikt, wenn Laptop und Tablet gleichzeitig sammeln). */
function deviceId(): string {
	let id = readLocal(DEVICE_KEY);
	if (!id) {
		id = shortId(6);
		writeLocal(DEVICE_KEY, id);
	}
	return id;
}

/**
 * Proben des Schreibtrainings im Vault unter `<Ink-Ordner>/_training/samples-<Gerät>.jsonl` – im Vault (nicht im
 * Plugin-Ordner), damit der Sync sie auf alle Geräte bringt. Gelesen werden die Dateien aller Geräte.
 */
export class SampleStore {
	private cache: { stamp: string; samples: TrainingSample[] } | null = null;

	constructor(private readonly plugin: InkBlocksPlugin) {}

	get folder(): string {
		return normalizePath(`${this.plugin.settings.folder}/_training`);
	}

	private files(): TFile[] {
		const prefix = `${this.folder}/`;
		return this.plugin.app.vault
			.getFiles()
			.filter((f) => f.path.startsWith(prefix) && f.extension === "jsonl" && f.basename.startsWith("samples"))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** Alle Proben (neu gelesen, wenn sich eine Datei geändert hat); gleiche Wörter nur mit der letzten Probe. */
	async load(): Promise<TrainingSample[]> {
		const files = this.files();
		const stamp = files.map((f) => `${f.path}@${f.stat.mtime}:${f.stat.size}`).join("|");
		if (this.cache?.stamp === stamp) return this.cache.samples;
		const all: TrainingSample[] = [];
		for (const f of files) all.push(...parseSamples(await this.plugin.app.vault.read(f)));
		all.sort((a, b) => a.at.localeCompare(b.at));
		const samples = dedupeSamples(all);
		this.cache = { stamp, samples };
		return samples;
	}

	/** Neue Probe anhängen; `id`, Zeitpunkt und Gerät werden ergänzt. */
	async add(sample: Omit<TrainingSample, "id" | "at" | "device">): Promise<TrainingSample> {
		const full: TrainingSample = { id: shortId(8), at: new Date().toISOString(), device: Platform.isMobileApp ? "mobile" : "desktop", ...sample };
		const { vault } = this.plugin.app;
		const path = `${this.folder}/samples-${deviceId()}.jsonl`;
		const line = `${encodeSample(full)}\n`;
		const file = vault.getFileByPath(path);
		if (file) await vault.append(file, line);
		else {
			if (!vault.getFolderByPath(this.folder)) await vault.createFolder(this.folder);
			await vault.create(path, line);
		}
		this.cache = null;
		return full;
	}
}
