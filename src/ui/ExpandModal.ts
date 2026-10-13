import { Modal } from "obsidian";
import { InkEditor, type ResolvedBackground } from "../block/InkEditor";
import type InkBlocksPlugin from "../main";
import type { OcrTarget } from "../ocr/OcrService";
import type { Pattern, PatternChange } from "../model/pattern";
import type { InkEntry, InkEvent } from "../store/InkStore";

export interface ExpandOptions {
	plugin: InkBlocksPlugin;
	inkPath: string;
	pattern(): Pattern;
	setPattern(change: PatternChange): void;
	background: ResolvedBackground;
	/** Texterkennung zielt weiter auf den Block in der Notiz. */
	ocrTarget(): OcrTarget | null;
}

/**
 * Ausgeklappte Schreibfläche: dieselbe .ink-Datei groß im Fenster (Heft bzw. Arbeitsblatt füllt die
 * Breite, wie hineingezoomt). Änderungen landen sofort im Store, der Block in der Notiz zeichnet mit.
 */
export class ExpandModal extends Modal {
	private editor: InkEditor | null = null;
	private entry: InkEntry | null = null;

	constructor(private readonly opts: ExpandOptions) {
		super(opts.plugin.app);
	}

	async onOpen() {
		const { plugin } = this.opts;
		this.modalEl.addClass("ink-expanded-modal");
		this.titleEl.setText(this.opts.inkPath.split("/").pop() ?? "");
		// Eigene Referenz: der Block in der Notiz kann währenddessen neu gerendert werden (z. B. durch text:).
		this.entry = await plugin.store.acquire(this.opts.inkPath, this.onStoreEvent).catch(() => null);
		if (!this.entry) return this.close();
		const entry = this.entry;
		const scroll = this.contentEl.createDiv({ cls: "ink-expanded-scroll" });
		const container = scroll.createDiv({ cls: "ink-block ink-expanded is-active" });
		this.editor = new InkEditor(container, {
			plugin,
			entry,
			pattern: () => this.opts.pattern(),
			setPattern: (change) => {
				this.opts.setPattern(change);
				this.editor?.refresh();
			},
			background: this.opts.background,
			commit: () => {
				plugin.store.touch(entry);
				plugin.store.changed(entry, this.onStoreEvent);
				const target = this.opts.ocrTarget();
				if (target) plugin.ocr.schedule(target);
			},
			activate: () => this.editor?.surface.el.focus({ preventScroll: true }),
			toggleExpand: () => this.close(),
			expanded: true,
		});
		// Eigener Tastatur-Scope des Dialogs: Strg+Z & Co. wirken hier nur auf die Tinte.
		this.scope.register(["Mod"], "z", () => (this.editor?.undo(), false));
		this.scope.register(["Mod", "Shift"], "z", () => (this.editor?.redo(), false));
		this.scope.register(["Mod"], "y", () => (this.editor?.redo(), false));
		this.editor.surface.el.focus({ preventScroll: true });
	}

	onClose() {
		this.editor?.destroy();
		this.editor = null;
		if (this.entry) this.opts.plugin.store.release(this.entry, this.onStoreEvent);
		this.entry = null;
		this.contentEl.empty();
	}

	private readonly onStoreEvent = (event: InkEvent) => {
		if (event === "deleted") this.close();
		else this.editor?.setDoc();
	};
}
