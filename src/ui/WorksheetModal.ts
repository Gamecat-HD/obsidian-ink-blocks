import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { backgroundKind } from "../render/background";

/** Auswahl einer PDF-/Bilddatei aus dem Vault. */
export class WorksheetFileModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Arbeitsblatt wählen (PDF oder Bild) …");
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => backgroundKind(f))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile) {
		this.onPick(file);
	}
}

/** Auswahl der Seite(n) eines mehrseitigen PDFs. `0` = alle Seiten. */
export class WorksheetPageModal extends FuzzySuggestModal<number> {
	private picked = false;

	constructor(
		app: App,
		private readonly pageCount: number,
		private readonly onPick: (pages: number[]) => void,
		private readonly onCancel?: () => void,
	) {
		super(app);
		this.setPlaceholder(`Seite wählen (1–${pageCount}) …`);
	}

	onClose() {
		super.onClose();
		// Obsidian ruft onChooseItem erst nach onClose auf → Abbruch erst verzögert melden.
		window.setTimeout(() => {
			if (!this.picked) this.onCancel?.();
		}, 0);
	}

	getItems(): number[] {
		return [0, ...Array.from({ length: this.pageCount }, (_, i) => i + 1)];
	}

	getItemText(page: number): string {
		return page === 0 ? `Alle Seiten (${this.pageCount})` : `Seite ${page}`;
	}

	onChooseItem(page: number) {
		this.picked = true;
		this.onPick(page === 0 ? this.getItems().slice(1) : [page]);
	}
}
