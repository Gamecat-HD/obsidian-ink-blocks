import { Modal, Notice, type App, type TFile } from "obsidian";

/** Listet .ink-Dateien, auf die kein ink-Block mehr verweist, und verschiebt sie auf Wunsch in den Papierkorb. */
export class OrphanModal extends Modal {
	constructor(
		app: App,
		private readonly orphans: TFile[],
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Verwaiste Ink-Dateien");
		const { contentEl } = this;
		if (!this.orphans.length) {
			contentEl.createEl("p", { text: "Keine gefunden – jede .ink-Datei wird von einem Block verwendet." });
			return;
		}
		contentEl.createEl("p", {
			text:
				`${this.orphans.length} Datei(en) werden von keinem ink-Block verwendet. Achtung: Kommt eine Notiz ` +
				"noch per Sync von einem anderen Gerät, kann sie fälschlich hier auftauchen.",
		});
		const list = contentEl.createEl("ul", { cls: "ink-orphan-list" });
		for (const f of this.orphans) {
			list.createEl("li", { text: `${f.path} · ${new Date(f.stat.mtime).toLocaleDateString()} · ${(f.stat.size / 1024).toFixed(1)} KB` });
		}
		const actions = contentEl.createDiv({ cls: "ink-orphan-actions" });
		actions.createEl("button", { text: "Schließen" }).onclick = () => this.close();
		const trash = actions.createEl("button", { text: "In den Papierkorb", cls: "mod-warning" });
		trash.onclick = async () => {
			trash.disabled = true;
			for (const f of this.orphans) await this.app.fileManager.trashFile(f);
			new Notice(`${this.orphans.length} verwaiste Ink-Datei(en) in den Papierkorb verschoben.`);
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}
