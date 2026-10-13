import { MarkdownRenderChild, Plugin } from "obsidian";
import { PenDiagnosticsModal } from "./diagnostics";

export default class InkBlocksPlugin extends Plugin {
	async onload() {
		this.registerMarkdownCodeBlockProcessor("ink", (source, el, ctx) => {
			ctx.addChild(new InkBlockStub(el, source));
		});

		this.addCommand({
			id: "pen-diagnostics",
			name: "Pen diagnostics",
			callback: () => new PenDiagnosticsModal(this.app).open(),
		});
	}
}

/** Platzhalter, bis Phase 1 (Canvas + Sidecar) steht. Zeigt nur die Block-Parameter an. */
class InkBlockStub extends MarkdownRenderChild {
	constructor(containerEl: HTMLElement, private readonly source: string) {
		super(containerEl);
	}

	onload() {
		const box = this.containerEl.createDiv({ cls: "ink-block-stub" });
		box.createEl("strong", { text: "ink block (todo)" });
		for (const key of ["file", "bg"]) {
			const value = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(this.source)?.[1];
			if (value) box.createDiv({ text: `${key}: ${value}` });
		}
	}
}
