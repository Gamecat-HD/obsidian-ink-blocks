import { MarkdownRenderChild, normalizePath, type MarkdownPostProcessorContext, type TAbstractFile } from "obsidian";
import type InkBlocksPlugin from "../main";
import { InkFormatError } from "../model/ink-format";
import type { InkEntry, InkEvent } from "../store/InkStore";
import { parseBlock, type BlockFields } from "./source";

/**
 * Ein gerenderter ```ink-Block. Der Zustand lebt im InkStore – Live Preview baut diese Instanz bei
 * jeder Änderung am Blockinhalt neu auf (siehe docs/SPIKES.md, S4).
 */
export class InkBlockChild extends MarkdownRenderChild {
	private entry: InkEntry | null = null;
	private fields: BlockFields;
	private alive = false;

	constructor(
		containerEl: HTMLElement,
		source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly plugin: InkBlocksPlugin,
	) {
		super(containerEl);
		this.fields = parseBlock(source);
	}

	get path(): string | null {
		return this.fields.file ? normalizePath(this.fields.file) : null;
	}

	onload() {
		this.alive = true;
		this.plugin.dev.loaded++;
		this.containerEl.addClass("ink-block");
		this.containerEl.dataset.instance = String(this.plugin.dev.loaded);
		void this.mount();
	}

	onunload() {
		this.alive = false;
		this.plugin.dev.unloaded++;
		this.detach();
	}

	private detach() {
		if (this.entry) this.plugin.store.release(this.entry, this.onStoreEvent);
		this.entry = null;
	}

	private async mount() {
		const path = this.path;
		if (!path) return this.showMessage("Kein `file:` im ink-Block angegeben.");

		let entry: InkEntry | null;
		try {
			entry = await this.plugin.store.acquire(path, this.onStoreEvent);
		} catch (e) {
			const reason = e instanceof InkFormatError ? e.message : String(e);
			return this.showMessage(`Ink-Datei beschädigt: ${path}`, reason);
		}
		if (!this.alive) {
			if (entry) this.plugin.store.release(entry, this.onStoreEvent);
			return;
		}
		if (!entry) {
			this.showMessage(`Ink-Datei fehlt: ${path}`, "Wird angezeigt, sobald die Datei auftaucht (z. B. nach dem Sync).");
			this.waitForFile(path);
			return;
		}
		this.entry = entry;
		this.render();
	}

	private waitForFile(path: string) {
		const ref = this.plugin.app.vault.on("create", (file: TAbstractFile) => {
			if (file.path !== path) return;
			this.plugin.app.vault.offref(ref);
			void this.mount();
		});
		this.registerEvent(ref);
	}

	private readonly onStoreEvent = (event: InkEvent) => {
		if (event === "deleted") {
			this.entry = null;
			void this.mount();
		} else {
			this.render();
		}
	};

	private render() {
		const entry = this.entry;
		if (!entry) return;
		const { doc } = entry;
		this.containerEl.empty();
		this.containerEl.removeClass("is-message");
		const surface = this.containerEl.createDiv({ cls: "ink-surface" });
		surface.style.aspectRatio = `${doc.w} / ${doc.h}`;
		surface.dataset.path = entry.path;
		surface.dataset.strokes = String(doc.strokes.length);
	}

	private showMessage(title: string, detail?: string) {
		this.containerEl.empty();
		this.containerEl.addClass("is-message");
		const box = this.containerEl.createDiv({ cls: "ink-message" });
		box.createDiv({ cls: "ink-message-title", text: title });
		if (detail) box.createDiv({ cls: "ink-message-detail", text: detail });
	}
}
