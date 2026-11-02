import { Modal, type App } from "obsidian";

/** Rückfrage vor dem Löschen einer Schreibfläche bzw. Arbeitsblatt-Seite. */
export class ConfirmDeleteModal extends Modal {
	constructor(
		app: App,
		private readonly what: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(`${this.what} löschen?`);
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: "Der Block verschwindet aus der Notiz, die Handschrift kommt in den Papierkorb und lässt sich von dort wiederherstellen.",
		});
		const actions = contentEl.createDiv({ cls: "ink-confirm-actions" });
		actions.createEl("button", { text: "Abbrechen" }).onclick = () => this.close();
		const confirm = actions.createEl("button", { text: "Löschen", cls: "mod-warning" });
		confirm.onclick = () => {
			this.close();
			this.onConfirm();
		};
		window.setTimeout(() => confirm.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}
