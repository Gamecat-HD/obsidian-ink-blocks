import { Notice } from "obsidian";
import type InkBlocksPlugin from "../main";
import type { TuneSample } from "../ocr/protocol";
import { isHoldout, labeled } from "./samples";
import { chooseTuning, MIN_TUNE_SAMPLES, percent, tuneGrid } from "./tuning";

/** „Erkennung auf meine Schrift abstimmen“: Raster über die Proben, Ergebnis als Hinweis, bei Erfolg übernommen. */
export async function runTuning(plugin: InkBlocksPlugin): Promise<boolean> {
	const items = labeled(await plugin.training.load());
	if (items.length < MIN_TUNE_SAMPLES) {
		new Notice(`Schreibtraining: Erst ${items.length} Proben – zum Abstimmen braucht es mindestens ${MIN_TUNE_SAMPLES}. Diktat oder Überprüfen liefert welche.`, 8000);
		return false;
	}
	const { ocr } = plugin;
	const current = { weight: ocr.ensembleWeight, alpha: ocr.decoderParams.alpha, beta: ocr.decoderParams.beta };
	const samples: TuneSample[] = items
		.map((s) => ({ segs: ocr.tuneSegments(s.strokes, s.refHeight), text: s.text, holdout: isHoldout(s.id) }))
		.filter((s) => s.segs.length);
	const notice = new Notice(`Stimme die Erkennung auf ${samples.length} Proben ab …`, 0);
	let ensemble = false;
	try {
		const results = await ocr.tune(samples, (setup) => {
			ensemble = setup.ensemble;
			return tuneGrid(setup, current);
		});
		const choice = results && chooseTuning(results, { ...current, weight: ensemble ? current.weight : 0 });
		if (!choice) {
			notice.setMessage("Abstimmen nicht möglich: Es ist kein de-htr-web-Modell geladen.");
			return false;
		}
		const { best, baseline, accept } = choice;
		const holdout = samples.filter((s) => s.holdout).length;
		if (!accept) {
			notice.setMessage(
				`Keine bessere Einstellung gefunden (Fehler ${percent(baseline.tune)}, Kontrolle ${percent(baseline.holdout)}). Es bleibt, wie es ist – mit mehr Proben noch einmal versuchen.`,
			);
			return false;
		}
		plugin.settings.ocrTuned = {
			// Ohne Zweitmodell wurde der Anteil nicht gemessen – der bisherige bleibt für später.
			weight: ensemble ? best.params.weight : current.weight,
			alpha: best.params.alpha,
			beta: best.params.beta,
			samples: samples.length,
			holdout,
			before: baseline.holdout.chars ? baseline.holdout.errors / baseline.holdout.chars : baseline.tune.errors / Math.max(1, baseline.tune.chars),
			after: best.holdout.chars ? best.holdout.errors / best.holdout.chars : best.tune.errors / Math.max(1, best.tune.chars),
			at: new Date().toISOString(),
		};
		await plugin.saveSettings();
		ocr.applyTuning();
		ocr.reset();
		notice.setMessage(
			`Abgestimmt: Fehler ${percent(baseline.tune)} → ${percent(best.tune)}` +
				(holdout ? `, Kontrolle ${percent(baseline.holdout)} → ${percent(best.holdout)}` : "") +
				` (v1-Anteil ${best.params.weight}, α ${best.params.alpha}, β ${best.params.beta}).`,
		);
		return true;
	} catch (e) {
		notice.setMessage(`Abstimmen fehlgeschlagen: ${(e as Error).message}`);
		return false;
	} finally {
		window.setTimeout(() => notice.hide(), 12000);
	}
}

/** Abgestimmte Werte verwerfen, zurück zu den eingebauten. */
export async function resetTuning(plugin: InkBlocksPlugin) {
	plugin.settings.ocrTuned = null;
	await plugin.saveSettings();
	plugin.ocr.applyTuning();
	plugin.ocr.reset();
}
