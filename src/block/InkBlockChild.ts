import { MarkdownRenderChild, normalizePath, type MarkdownPostProcessorContext, type TAbstractFile } from "obsidian";
import { PointerPipeline } from "../input/PointerPipeline";
import type InkBlocksPlugin from "../main";
import { InkFormatError } from "../model/ink-format";
import type { InkOp } from "../model/ops";
import { Surface } from "../render/Surface";
import type { BgStyle } from "../settings";
import type { InkEntry, InkEvent } from "../store/InkStore";
import { parseBlock, type BlockFields } from "./source";

/**
 * Ein gerenderter ```ink-Block. Der Zustand lebt im InkStore – Live Preview baut diese Instanz bei
 * jeder Änderung am Blockinhalt neu auf (siehe docs/SPIKES.md, S4).
 */
export class InkBlockChild extends MarkdownRenderChild {
	private entry: InkEntry | null = null;
	private surface: Surface | null = null;
	private pipeline: PointerPipeline | null = null;
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
		this.plugin.blocks.add(this);
		this.plugin.dev.loaded++;
		this.containerEl.addClass("ink-block");
		this.containerEl.dataset.instance = String(this.plugin.dev.loaded);
		void this.mount();
	}

	onunload() {
		this.alive = false;
		this.plugin.blocks.delete(this);
		this.plugin.dev.unloaded++;
		this.teardown();
		if (this.entry) this.plugin.store.release(this.entry, this.onStoreEvent);
		this.entry = null;
	}

	/** Nach Theme- oder Einstellungswechsel neu zeichnen. */
	refresh() {
		this.surface?.setBgStyle(this.bgStyle);
		this.surface?.redrawAll();
	}

	private get bgStyle(): BgStyle {
		const style = this.fields.bgStyle;
		return style === "ruled" || style === "grid" || style === "blank" ? style : this.plugin.settings.bgStyle;
	}

	private teardown() {
		this.pipeline?.destroy();
		this.surface?.destroy();
		this.pipeline = null;
		this.surface = null;
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
			this.teardown();
			this.entry = null;
			void this.mount();
		} else if (this.entry) {
			// Neu geladen (Sync) oder von einem anderen Block derselben Datei geändert.
			this.surface?.setDoc(this.entry.doc);
		}
	};

	private readonly onOp = (_op: InkOp) => {
		const entry = this.entry;
		if (!entry) return;
		this.plugin.store.touch(entry);
		this.plugin.store.changed(entry, this.onStoreEvent);
	};

	private render() {
		const entry = this.entry;
		if (!entry) return;
		this.teardown();
		this.containerEl.empty();
		this.containerEl.removeClass("is-message");
		this.surface = new Surface(this.containerEl, entry.doc, this.bgStyle);
		this.surface.el.dataset.path = entry.path;
		this.pipeline = new PointerPipeline(this.plugin, entry, this.surface, this.onOp);
	}

	private showMessage(title: string, detail?: string) {
		this.teardown();
		this.containerEl.empty();
		this.containerEl.addClass("is-message");
		const box = this.containerEl.createDiv({ cls: "ink-message" });
		box.createDiv({ cls: "ink-message-title", text: title });
		if (detail) box.createDiv({ cls: "ink-message-detail", text: detail });
	}
}
