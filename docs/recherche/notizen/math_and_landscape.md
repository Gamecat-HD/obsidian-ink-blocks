# Local handwritten math/structure recognition and the existing-tool landscape (as of 2026-10-17)

Scope: free/open, local-only, runnable inside an Obsidian (Electron) plugin via Web Worker + onnxruntime-web (WASM/WebGPU) or transformers.js. Cloud tools are only noted as "not suitable". Research budget was limited (~17 tool calls), so many items are only partially verified; unverified points are in the Gaps sections.

## A1. Which handwritten math / image-to-LaTeX recognizers can run locally in the browser?

### Takeaway
No released *online (stroke)* math recognizer is browser-ready. The realistic path is *offline* (rendered image) image-to-LaTeX: **texify via transformers.js (Xenova/texify, ready-made ONNX)**, **RapidLatexOCR / pix2tex ONNX (MIT, onnxruntime-web)**, or **Pix2Text MFR (TrOCR-based, ONNX by default)**. A new 2026 paper, **Texo (~20M params, claims in-browser deployment)**, is the most promising small candidate if weights are released. The strong CROHME research models (CoMER/TAMER/ICAL/PosFormer, ~59–62 % ExpRate on CROHME 2014) are PyTorch research code with no ONNX/browser builds; they would need custom export work. MathWriting (Google, 2024) is a dataset, not a model.

### Cited Findings
**Datasets**
- MathWriting (Google, April 2024): ~230k human-written + ~400k synthetic *online* handwritten math samples; each sample = touchscreen ink strokes + LaTeX label, plus a normalized LaTeX label; described as the largest online HME dataset; can also be rendered for offline recognition — [arXiv 2404.10690](https://arxiv.org/html/2404.10690v1)
- MathWriting full dataset ~2.9 GB (`mathwriting-2024.tgz`), 1.5 MB excerpt; baselines reported for OCR, CTC Transformer and PaLI VLM; code in google-research GitHub. No trained recognition model was released alongside it (none found in search) — [arXiv 2404.10690](https://www.arxiv.org/pdf/2404.10690); [MarkTechPost summary](https://www.marktechpost.com/2024/04/23/google-ai-proposes-mathwriting-transforming-handwritten-mathematical-expression-recognition-with-extensive-human-written-and-synthetic-dataset-integration-and-enhanced-model-training/)

**CROHME research models (offline HMER)**
- TAMER (Tree-Aware Transformer, Aug 2024, AAAI 2025): 61.23 / 60.26 / 61.97 % ExpRate on CROHME 2014 / 2016 / 2019, compared without data augmentation (because others' augmentation is undisclosed) — [arXiv 2408.08578](https://arxiv.org/html/2408.08578v2)
- ICAL (Implicit Character-Aided Learning, May 2024): +2.25 points ExpRate over CoMER on CROHME 2014 (no-augmentation comparison) — [arXiv 2405.09032](https://arxiv.org/pdf/2405.09032)
- CoMER (2022): 59.33 % ExpRate on CROHME 2014 (with augmentation); later papers had to reproduce its no-augmentation numbers — [arXiv 2207.04410](https://arxiv.org/pdf/2207.04410); [TAMER paper](https://arxiv.org/pdf/2408.08578)
- Cross-paper ExpRate comparisons are unreliable (different reproductions, augmentation, training data) — [TAMER](https://arxiv.org/pdf/2408.08578); [ICAL](https://arxiv.org/pdf/2405.09032)
- Newer 2025–2026 HMER work exists: Uni-MuMER (VLM fine-tuning, May 2025) [arXiv 2505.23566](https://arxiv.org/pdf/2505.23566), SemiHMER (Feb 2025) [arXiv 2502.07172](https://arxiv.org/pdf/2502.07172), GryphOne (masked diffusion refinement, Feb 2026) which tabulates reproduced no-aug results for ICAL, TAMER, PosFormer — [arXiv 2602.03370](https://arxiv.org/pdf/2602.03370). VLM-based approaches (Uni-MuMER) are far too large for an in-plugin worker (inference).

**Printed+handwritten formula OCR (image-to-LaTeX), browser-relevant**
- **texify (vikp) → Xenova/texify**: ONNX weights "to be compatible with Transformers.js"; usage `pipeline('image-to-text','Xenova/texify')`, `max_new_tokens` e.g. 384; package `@huggingface/transformers`. Also `Xenova/texify2` and `onnx-community/texify-ONNX` ("OCRs equation images and text to LaTeX"). Model card states no license, sizes or handwriting notes — [HF Xenova/texify](https://huggingface.co/Xenova/texify); [HF texify2](https://huggingface.co/Xenova/texify2); [onnx-community/texify-ONNX](https://huggingface.co/onnx-community/texify-ONNX/blob/main/README.md)
- **pix2tex / LaTeX-OCR (lukas-blecher)**: MIT license; ViT encoder with ResNet backbone + Transformer decoder; BLEU 0.88, normalized edit distance 0.10, token accuracy 0.60 (printed test set); handwritten support only "kinda done" (unchecked TODO); no official ONNX export in the repo — [GitHub LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR)
- **RapidLatexOCR** (RapidAI): ONNX/OpenVINO re-packaging of pix2tex, four ONNX files (image_resizer, encoder, decoder, tokenizer); a re-hosted copy on HF is explicitly meant to run client-side via onnxruntime-web — [rapid-latex-ocr PyPI](https://pypi.org/project/rapid-latex-ocr/0.0.4/); [HF inYourOwnBrowser/rapid-latex-ocr-onnx](https://huggingface.co/inYourOwnBrowser/rapid-latex-ocr-onnx)
- **Pix2Text MFR** (breezedeus): TrOCR-based model retrained on formula images → LaTeX; current `LatexOCR` defaults to model `mfr-1.5` with `onnx` backend; an earlier release (0.2.3) claimed higher accuracy "especially for handwritten formulas and multi-line formulas"; 1.1.x uses a new architecture/dataset; quantized community copy exists — [Pix2Text docs](https://pix2text.readthedocs.io/zh/latest/pix2text/latex_ocr/); [HF pix2text-mfr](https://huggingface.co/kinghtwo/pix2text-mfr); [HF quantized](https://huggingface.co/Brian314/pix2text-mfr-quantized); [PyPI 1.1.0.7](https://pypi.org/project/pix2text/1.1.0.7)
- **UniMERNet** (2024): 107M (Tiny) – 325M (Base) params; handwritten-expression (HWE) BLEU ≈ 0.886–0.895 on UniMER-Test across ablation variants (0.893 for 325M) — BLEU, not ExpRate — [Texo paper](https://arxiv.org/pdf/2602.17189); [UniMERNet arXiv 2404.15254](https://arxiv.org/html/2404.15254v2)
- **PP-FormulaNet** (PaddlePaddle, Mar 2025): 58M (S) – 181M (L); L beats UniMERNet by ~6 % accuracy, S is >16× faster; PP-FormulaNet_plus-S model card lists En-BLEU 87.00 vs UniMERNet 85.91 (non-handwriting set) — [arXiv 2503.18382](https://arxiv.org/html/2503.18382v1); [HF PP-FormulaNet_plus-S](https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S)
- **Texo** (Feb 19, 2026): ~20M params; "comparable" to UniMERNet-T and PP-FormulaNet-S while ~80 % / ~65 % smaller; abstract claims real-time inference on consumer hardware and "even in-browser deployment" with a demo web app; transfers vocabulary/tokenizer via distillation — [arXiv 2602.17189](https://arxiv.org/abs/2602.17189)

**Browser / JS stroke-side tools**
- `handwritten-mathematics-recogniser` (MIT, TypeScript + TF models): browser canvas recognizer for digits/expressions, but last published ~8 years ago (v0.0.6) and requires segmentable, non-touching symbols — [GitHub](https://github.com/MaciejCaputa/handwritten-mathematics-recogniser); [npm](https://www.npmjs.com/package/handwritten-mathematics-recogniser)
- Sagyam/Handwritten-Optical-Character-Recognition: TF.js in-browser single-symbol recognizer + calculator (license not verified) — [GitHub](https://github.com/Sagyam/Handwritten-Optical-Character-Recognition)
- MyScript math-web (Apache-2.0 web component, 200+ symbols) — recognition in MyScript Cloud with API keys → **not suitable** — [GitHub](https://github.com/MyScript/myscript-math-web)

### Inferences
- Best near-term pipeline for Ink Blocks: rasterize the ink block (white bg, normalized stroke width, crop to bbox) → run an offline image-to-LaTeX model in a Worker. texify (transformers.js, zero conversion work) or RapidLatexOCR/pix2tex (MIT, plain onnxruntime-web) are the lowest-effort options; Pix2Text MFR is likely the best handwriting accuracy among the ONNX-ready ones given its handwriting-focused training claims, but license must be checked.
- Rendering strokes to images discards temporal info, but all ONNX-ready models are offline; MathWriting could be rendered to fine-tune/evaluate any of them on *your* stroke style.
- A "math vs text" router is needed (e.g., user marks a block as `math`, or heuristics like presence of fraction bars/superscripts), since formula models hallucinate LaTeX on prose and text OCR fails on formulas.
- Storing output as LaTeX in the `text:` field also makes formulas searchable as plain tokens (e.g., `\frac`, `x^2`).
- Texo is the item to watch: if its weights + ONNX appear, ~20M params would be ideal for a plugin download (~20–80 MB depending on quantization).

### Gaps
- Licenses not verified this session: texify weights (vikp; historically code GPL-3 / weights possibly restrictive), Pix2Text MFR weights, UniMERNet, PP-FormulaNet, CoMER/TAMER/ICAL/PosFormer code, MathWriting dataset license. Must be checked before bundling.
- ONNX file sizes for texify / pix2tex / Pix2Text MFR not found; parameter counts for pix2tex not stated in repo.
- No CROHME ExpRate found for texify, pix2tex, Pix2Text MFR or Texo — handwriting accuracy of the browser-ready models is unknown and needs local benchmarking (e.g., on CROHME or rendered MathWriting test split).
- PosFormer's own CROHME 2014 ExpRate not confirmed in this session.
- PP-FormulaNet ONNX export / onnxruntime-web compatibility not checked (Paddle → ONNX via paddle2onnx is plausible but unverified).
- No Detexify-style JS symbol classifier with a current maintained release was found; KaTeX/MathJax have no recognition side (they only render — useful to *display* recognized LaTeX).
- Whether Texo weights/code are publicly released, and under which license, is not stated on the arXiv page.

## A2. Open tools for recognizing simple tables, arrows, checkmarks/crosses in worksheets

### Takeaway
No dedicated open, browser-runnable recognizer for hand-drawn tables/arrows/checkmarks was found. These are best handled with cheap custom geometry on the stroke data (the plugin has the strokes) rather than ML.

### Cited Findings
- Xournal++ contains a "stroke recognizer" inherited from original Xournal code (appears to be shape recognition; exact function not documented in the sources found) — [Xournal++ fork README](https://github.com/BHatGuy/xournalpp)
- No search result surfaced an open checkbox/arrow/table recognizer for handwriting (searches for stroke-based recognizers only returned math/character tools) — [GitHub topic handwriting-recognition (JS)](https://github.com/topics/handwriting-recognition?l=javascript)

### Inferences
- Checkmarks/crosses in PDF worksheets: since worksheet answer zones are known positions, a simple rule-based classifier (stroke count, angle changes, bounding-box overlap with a known checkbox) is likely more robust than any generic model. A tiny CNN on a rasterized crop (like the TF.js symbol classifiers above) is a fallback.
- Tables: detect long near-straight horizontal/vertical strokes → grid → run text OCR per cell → emit Markdown table in `text:`.
- Arrows: line + two short strokes at one end (classic $1/Protractor-style unistroke/multistroke recognizers, e.g. the $-family from UW, are tiny JS and could be reused — not verified this session).

### Gaps
- Did not verify Xournal++'s shape recognizer source/license (GPL-2.0 likely) or the $1/$N recognizer licenses.
- No benchmark data for any of these structural recognizers.

## B1. Obsidian plugins dealing with handwriting/ink/OCR — which recognize locally, and how?

### Takeaway
Only a few plugins do local recognition, and all use either Tesseract(.js) (poor on handwriting), OS OCR (Lens OCR: macOS Vision / Windows.Media.Ocr), or a local LLM server (Ollama/LM Studio — an external program, so not in-plugin). **InkedMark** is the closest direct competitor to Ink Blocks: ink inside markdown with a searchable text layer and an *experimental in-plugin TrOCR (English-only, 250 MB / 1.3 GB download)*. The well-known **Ink** plugin (daledesilva, tldraw) does no transcription.

### Cited Findings
- **Ink** (daledesilva): handwriting/drawing between paragraphs on a tldraw canvas ("handwriting, sketches, scribbles, or even math equations"); no handwriting-to-text feature found — [Obsidian community: ink](https://community.obsidian.md/plugins/ink); [obsidianstats](https://www.obsidianstats.com/plugins/ink)
- **InkedMark** (Liqpil, MIT, v1.4.0 ~Sep 2026 "a month ago", adds paper guides): `*.ink.md` pen-first canvas + typed text layer indexed by Obsidian search/graph/backlinks; embeds via `![[Sketch.ink.md]]` or ```` ```inkedmark ```` blocks; single markdown file with frontmatter `inkedmark: true`, text layer as body, strokes in trailing `%%inkedmark … %%` comment. Recognition: Manual (default, no network); Cloud AI BYOK (Anthropic/OpenAI/Google/OpenRouter or custom OpenAI-compatible endpoint incl. Ollama/LM Studio/llama.cpp/vLLM/LocalAI); **On-device (experimental, desktop only): offline TrOCR line-by-line, English-only, downloads ~250 MB (Fast) or ~1.3 GB (Accurate) from HF on first use** — [obsidianstats InkedMark](https://www.obsidianstats.com/plugins/inkedmark)
- **Text Extractor** (Simon Cambier/scambier, GPL-3.0, v0.7.0, marked "Unmaintained"): Tesseract.js + pdf-extract, local processing but language files downloaded on demand; caches text as small JSON files in plugin dir (syncable; mobile uses cache only); built for Omnisearch; handwriting not mentioned — [Obsidian community: text-extractor](https://community.obsidian.md/plugins/text-extractor)
- **Omnisearch** supports OCR/PDF indexing (via Text Extractor) — [obsidianstats OCR tag](https://www.obsidianstats.com/tags/ocr)
- **Petrify**: converts handwritten note files to Excalidraw/Markdown; Tesseract option runs locally once language data is downloaded; alternative Google Cloud Vision (cloud) — [community: petrify](https://community.obsidian.md/plugins/petrify)
- **Obsidian OCR**: Tesseract by default, auto-processes new images/PDFs — [obsidianstats](https://www.obsidianstats.com/plugins/obsidian-ocr)
- **OCR Extractor**: default Mistral OCR (cloud); local Tesseract added; v2.3.0 can use local vision models via Ollama/LM Studio — [forum thread](https://forum.obsidian.md/t/ocr-extractor-extract-text-from-documents-images-etc-as-searchable-markdown/109450); [obsidianstats](https://www.obsidianstats.com/plugins/ocr-extractor)
- **Lens OCR** (v0.1.1): uses OS built-in OCR (macOS Vision, Windows.Media.Ocr), offline, no bundled models, pastes at cursor — [community: lens-ocr](https://community.obsidian.md/plugins/lens-ocr)
- **AI Image OCR**: local vision models via Ollama/LM Studio, no API key — [community: ai-image-ocr](https://community.obsidian.md/plugins/ai-image-ocr)
- **Apple Pencil for Obsidian** (jonthornton07, iPad): ink → Markdown via GPT-4o/Claude/Gemini/Google Vision (cloud) or on-device Tesseract — [GitHub](https://github.com/jonthornton07/obsidian-apple-pencil-plugin)
- **Inkporter**: isolates ink from scanned handwritten notes (image cleanup, no transcription) — [community: inkporter](https://community.obsidian.md/plugins/inkporter)
- **Not suitable (cloud)**: Handwriting OCR (handwritingocr.com, vendor service) [community](https://community.obsidian.md/plugins/handwriting-ocr); Garda Handwriting Text OCR (metered backend, GPT-5 mini) [community](https://community.obsidian.md/plugins/garda-handwriting-text-ocr); Handwriting PDF (Gemini) [community](https://community.obsidian.md/plugins/handwriting-pdf); obsidian-handwrite (MyScript / Google Cloud Vision) [GitHub](https://github.com/MythraPS/obsidian-handwrite); Taskbone OCR (cloud OCR service) [obsidianstats](https://dev.obsidianstats.com/plugins/taskbone-ocr-plugin)

### Inferences
- InkedMark validates the exact UX direction of Ink Blocks (ink in markdown + searchable text layer) and shows a TrOCR-in-plugin approach is shippable, but its 250 MB–1.3 GB English-only download is a weakness Ink Blocks can beat with a smaller German-capable model and math routing.
- Text Extractor's design (on-demand extraction, JSON cache synced across devices, mobile reads cache only) is a good pattern for Ink Blocks' `text:` field: OCR on desktop, store result in-note so mobile/search never need the model.
- Tesseract-based plugins are not a viable baseline for handwriting.

### Gaps
- Khattat and Tegaki plugins were not found in searches; status unknown.
- Whether Excalidraw-for-Obsidian (zsviczian) still offers OCR and via which backend (historically Taskbone cloud) was not verified this session.
- Exact model/repo used by InkedMark's on-device TrOCR (likely microsoft/trocr-small/large-handwritten ONNX) not confirmed; its GitHub source not inspected.
- Full scan of community-plugins.json for 2025–2026 handwriting plugins not performed; obsidianstats "handwriting" tag page exists for that — [obsidianstats handwriting tag](https://www.obsidianstats.com/tags/handwriting)

## B2. Open-source note apps / web demos with local handwriting recognition to learn from or reuse

### Takeaway
None of the major open-source ink apps checked (Xournal++, Saber, Rnote) ship handwriting-to-text recognition according to the sources found; there is no model to "borrow" from them. Reusable assets come from model hubs (TrOCR/texify/pix2tex ONNX), not note apps.

### Cited Findings
- Xournal++: handwriting notes + PDF annotation; "stroke recognizer" from original Xournal (likely shapes); no text recognition mentioned — [Xournal++ fork](https://github.com/BHatGuy/xournalpp); [PureOS package](https://software.pureos.net/sw/com.github.xournalpp.xournalpp)
- Saber: pen/highlighter, text notes, selection, shape tool, encrypted sync — no handwriting recognition listed — [LinuxLinks: Saber](https://linuxlinks.com/saber/)
- Rnote: "Sketch and take handwritten notes"; no recognition found — [medevel list](https://medevel.com/os-handwritten-note-pps/)
- tldraw is the canvas behind the Ink plugin; no recognition there — [community: ink](https://community.obsidian.md/plugins/ink)
- In-browser symbol demos (TF.js) exist but are toy-level (single symbols, arithmetic) — [Sagyam HOCR](https://github.com/Sagyam/Handwritten-Optical-Character-Recognition)

### Inferences
- Since the open ink apps lack HTR, Ink Blocks would be ahead of them by shipping any decent local HTR. Their stroke file formats (Xournal++ .xopp, Rnote .rnote) are only relevant for import, not recognition.

### Gaps
- Not checked this session: Joplin, Logseq, Excalidraw (web), Write (Stylus Labs), Notesnook, Cosmic Note, KOReader, reMarkable/Supernote community tooling (e.g., rmscene/supernote-tool), Nextcloud (Recognize app is image tagging, not HTR — unverified). Recommend a follow-up search if needed.
- Rnote/Saber GitHub issue trackers were not inspected for planned HTR features.

## B3. New (2025–2026) open handwriting recognition SDKs/models from big vendors

### Takeaway
The only notable big-vendor open release found is Google's **InkSight** (derendering photo → digital ink; Apache-2.0 code; public "Small-p" model on HF; TMLR, June 2025) — useful for turning scanned/photographed worksheets into strokes, but it is TensorFlow-based with no ONNX/browser build. Google MathWriting (2024) is data only. No new permissive Microsoft, Apple, Samsung or Meta handwriting SDK was found.

### Cited Findings
- InkSight: offline-to-online handwriting conversion ("derendering"), ViT encoder + mT5 encoder-decoder; v4 June 17, 2025, accepted to TMLR; Google Research + EPFL; public model Small-p trained only on public data (Small-i/Large-i not released) — [arXiv 2402.05804](https://arxiv.org/abs/2402.05804)
- InkSight code Apache-2.0; Small-p in CPU/GPU and TPU builds; HF `Derendering/InkSight-Small-p`; TensorFlow code + local Gradio playground; no ONNX/TF.js mention; inference pipeline uses docTR + Tesseract for word detection; weights license not stated on README — [GitHub google-research/inksight](https://github.com/google-research/inksight)
- Human eval: 42–52.5 % "good traces", 12.5–18 % "bad traces" (2024 report) — [GIGAZINE](https://gigazine.net/gsc_news/en/20241029-model-convert-handwriting-photo-pen-stroke)
- MathWriting: Google dataset, no model release found — [arXiv 2404.10690](https://arxiv.org/html/2404.10690v1)
- No 2025 Microsoft open-source handwriting recognition release surfaced in search — [search result set on InkSight](https://arxiv.org/html/2402.05804)

### Inferences
- InkSight's direction (image → strokes) is the inverse of what Ink Blocks needs for its own ink (which already has strokes); it is only relevant for PDF-worksheet *photos/scans*. Ink Blocks' own ink can go directly to image models.
- Microsoft's TrOCR (HF, MIT per common knowledge — unverified here) remains the de-facto open handwritten-line model; InkedMark uses a TrOCR model on-device.

### Gaps
- InkSight-Small-p parameter count, weights license, and ONNX convertibility not verified.
- Apple (Vision/PencilKit), Samsung, Meta: no open handwriting models found; OS APIs (Windows Ink Analysis, macOS Vision) are proprietary and not callable from a cross-platform Electron plugin without native modules (Lens OCR uses them, mechanism not inspected).
- Did not check Google ML Kit Digital Ink Recognition (on-device but Android/iOS SDK only, proprietary terms) — likely not usable in Electron; unverified this session.
