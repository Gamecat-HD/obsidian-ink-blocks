import assert from "node:assert/strict";

export default async (h) => {
	const ok = await h.evaluate(() => !!app.commands.commands["obsidian-ink-blocks:pen-diagnostics"]);
	assert.ok(ok, "Command pen-diagnostics fehlt");
	await h.evaluate(() => app.workspace.openLinkText("Notiz", "", false));
	await h.sleep(500);
	await h.screenshot("smoke.png");
};
