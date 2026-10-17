# Offline (image-based) HTR models that could replace or complement naeyn/de-htr-web-v2

Research date: 2026-10-17. Scope: line- or page-level handwriting recognizers with open weights that run inside the plugin (onnxruntime-web WASM, transformers.js, TF.js). "HF search" means the Hugging Face model hub listing as of the research date.

## 1. New German / multilingual-Latin HTR releases 2025–2026; who naeyn is; is there a v3?

### Takeaway
naeyn/de-htr-web-v2 (Aug 2026) is still the newest and only small, browser-first, open German line recognizer I found. There is no v3 and no published roadmap. HF searches for "german handwriting" and "htr" turned up no German competitor. Recent HTR uploads target historical or non-Latin scripts.

### Cited Findings
- **naeyn's HF profile** lists only 3 models: `de-htr-web-v2` (updated Aug 1), `de-htr-web` (v1, Aug 1) and an unrelated `nobody-pii-de` token classifier (0.3B). It also has one dataset (`nobody-pii-synth-de`, 10.5k items), no Spaces, and links to github.com/naeyn. No v3 is listed. — [HF naeyn](https://huggingface.co/naeyn)
- **Model:**
  - Architecture: ImageNet-initialized ResNet18 stem (through layer3), 3× BiLSTM-256, CTC head. 10.06M parameters.
  - Input: grayscale, height 64, dynamic width up to 1024, output stride 4.
  - Alphabet: 112 symbols (blank + 111 characters).
  - Files: `model.onnx` int8 10.4 MB, `model-fp32.onnx` 40.3 MB.
  - I/O: input `image` (1-channel, [0,1], normalization built into the model), output `logits`, greedy CTC decoding. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)
- **v2 training data:**
  - ScaDS.AI German Line/Word Handwriting (CC BY 4.0, DOI 10.5281/zenodo.18301532): gold lines, word crops, and 5,240 page-XML extra lines.
  - fhswf/german_handwriting (AFL-3.0): 9,909 lines, used as auxiliary data.
  - No synthetic data, no IAM, no VLM pseudo-labels.
  - Recipe: 65 epochs with AdamW. About 3 h on one RTX 5070 Ti.
  - Ablations: the ImageNet stem gave −1.3 CER points, adding fhswf gave −0.94, and synthetic pretraining did not transfer.
  - Two-seed frame-wise CTC ensembling failed. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)
- **v2 results** on 601 lines from 78 held-out ScaDS writers (greedy decoding, no language model):

  | Model | CER | WER |
  |---|---|---|
  | v2 int8 | 8.01% | 32.3% |
  | v2 fp32 | 8.00% | 32.3% |
  | v1 int8 | 8.61% | 33.9% |

  Per-writer error is heavy-tailed: the median writer is around 6–8% CER, the hardest writers above 30%. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)
- **v2 limitations stated on the card:**
  - Modern German only; weak on math and symbols.
  - No printed-text guarantee.
  - Line input only; no segmentation.
  - Curly quotes and some accented characters are not in the alphabet.
  - No language model. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)
- **v1 → v2 breaking changes:**
  - Input: RGB `images` → grayscale `image`.
  - Output: `log_probs` → `logits`.
  - Alphabet: 195 → 112 symbols.
  - Maximum width: 2048 → 1024. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)
- **GitHub releases of naeyn/de-htr-web:**
  - v0.1.0 (29 Jul) was the first line-level browser release. It reports a median of **259 ms per line on Apple M1 / Chrome 151**.
  - v0.2.0 (01 Aug) makes v2 the default and adds a model picker.
  - The releases mention a "tiny-htr" training/ablation research project, but give no repo link.
  - There is no v3, no roadmap, and no language-model or lexicon decoding. — [naeyn/de-htr-web releases](https://github.com/naeyn/de-htr-web/releases)
- **HF search "german handwriting"** (sorted by modified) returned 0 models. — [HF search](https://huggingface.co/models?search=german%20handwriting&sort=modified)
- **HF search "htr"** (256 results; first 30 by date checked):
  - Most recent uploads are historical, Arabic, Syriac, Coptic, Armenian or Greek models, e.g. `nomikos-project/*-calamari`, `rakansuliman/arabic-htr-v2`, and Barbados competition weights.
  - Other entries: `Kansallisarkisto/multicentury-htr-model` (Finnish National Archives), `DAIR-Group/HTR-ConvText`, `PellelNitram/xournalpp-htr-simple-htr`.
  - None is tagged German or ONNX. — [HF search htr](https://huggingface.co/models?search=htr&sort=modified)
- **fhswf/TrOCR_german_handwritten:**
  - Fine-tuned from microsoft/trocr-large-handwritten, about 0.6B parameters in F32 safetensors, no ONNX.
  - CER 4.1% / WER 17.5% on its own fhswf test split (15 writers, so not comparable to naeyn's 78 unseen writers).
  - License AFL-3.0; last updated June 2024 (older). This is probably the "2.4 GB fine-tune" that was rejected earlier. — [fhswf/TrOCR_german_handwritten](https://huggingface.co/fhswf/TrOCR_german_handwritten)
- **Kraken "german_handwriting.mlmodel"** (Mannheim UB, Zenodo):
  - 16.4 MB, CC BY-SA 4.0, published May 2023 (older), based on a printed-text model.
  - "Ground truth from different sources" — for German manuscripts, era not stated. No CER reported.
  - It is a Kraken (PyTorch) model, not ONNX. — [Zenodo 7933463](https://zenodo.org/records/7933463)

### Inferences
- naeyn appears to be an individual developer (no affiliation on the card) with a short release history (v1 on 29 Jul, v2 on 1 Aug 2026). Plan for no upstream updates. Treat the alphabet, I/O and preprocessing as a frozen contract, and keep v1 as a fallback, because the I/O is incompatible.
- The fhswf TrOCR CER of 4.1% is on an in-domain, 15-writer split. It does not show that TrOCR-large beats naeyn on unseen writers.
- The v2 card's own figure (most of CER came from the stem change and adding fhswf, with synthetic data not helping) suggests that fine-tuning on the user's own lines is the best lever for domain terms. That needs a re-export of the same architecture.

### Gaps
- I found no "tiny-htr" repo link. The card mentions a separate research repo but does not link it.
- naeyn's GitHub profile (other repos, identity) was not inspected beyond the releases page.
- I found no browser speed figure for v2. Only v1 has one (259 ms/line, M1).

## 2. TrOCR small/base variants, ONNX conversions, sizes, German

### Takeaway
transformers.js TrOCR ONNX conversions exist only for Microsoft's English checkpoints and a few third-party fine-tunes (Russian, number plates). None is German. The smallest (`Xenova/trocr-small-handwritten`) is about 63 MB quantized and is an autoregressive encoder-decoder, so it is slower per line than a CTC model. Its tokenizer and training are English (IAM).

### Cited Findings
- **TrOCR models with transformers.js/ONNX tags on HF (8):**
  - `Xenova/trocr-small-handwritten` (5.41k downloads), `Xenova/trocr-base-handwritten`, `Xenova/trocr-small-printed`, `Xenova/trocr-base-printed` — all updated Oct 2024.
  - `onnx-community/trocr-base-stage1-ONNX` (Sep 2025).
  - `Mievst/trocr-base-handwritten-ru-ONNX` (Oct 2025, Russian).
  - `onnx-community/trocr-base-plate-number-ONNX` (Oct 2025).
  - `inYourOwnBrowser/trocr-base-handwritten-ONNX`.
  - None is German. — [HF transformers.js trocr](https://huggingface.co/models?library=transformers.js&search=trocr)
- **`Xenova/trocr-small-handwritten` ONNX files:**

  | Variant | Encoder | Decoder (merged) |
  |---|---|---|
  | fp32 | 87.5 MB | 159 MB |
  | fp16 | 44 MB | 79.9 MB |
  | "quantized" (precision not stated) | 23.1 MB | 40.5 MB |

  So about 64 MB in the quantized variant. — [Xenova/trocr-small-handwritten ONNX files](https://huggingface.co/Xenova/trocr-small-handwritten/tree/main/onnx)
- **German TrOCR:** the only German modern-handwriting TrOCR found is the fhswf large fine-tune (0.6B parameters, no ONNX, AFL-3.0, CER 4.1% on its own split). — [fhswf/TrOCR_german_handwritten](https://huggingface.co/fhswf/TrOCR_german_handwritten)
- **Other German TrOCRs** are historical Kurrent: `dh-unibe/trocr-kurrent` (19th c.) and `fgho/trocr-hanseXVI-kurrent`. — [dh-unibe/trocr-kurrent](https://huggingface.co/dh-unibe/trocr-kurrent), [fgho/trocr-hanseXVI-kurrent](https://huggingface.co/fgho/trocr-hanseXVI-kurrent)

### Inferences
- A German TrOCR-small would have to be fine-tuned by us (e.g. on ScaDS + fhswf) and exported with optimum. Even then it would be about 6× naeyn's int8 size and would need autoregressive decoding (one decoder pass per token), which is likely clearly slower than CTC in single-threaded WASM. Not attractive compared with fine-tuning naeyn's CTC architecture.
- The English `trocr-small-handwritten` could be tried as a second opinion for English IT terms. Its vocabulary covers umlauts, but they are likely rare in its IAM training data, so German quality is unknown.

### Gaps
- I found no published CER of any TrOCR-small/base on German modern handwriting.
- No browser latency figures for TrOCR-small in WASM were found.

## 3. PaddleOCR PP-OCRv5 / PP-OCRv6: Latin/German recognition, handwriting quality, browser ports

### Takeaway
PaddleOCR made big handwriting gains (v4 → v5 → v6), and good browser ports exist (official `@paddleocr/paddleocr-js`, `ppu-paddle-ocr` on onnxruntime-web). It also brings a text detector (page segmentation), which naeyn lacks. However:
- The only published handwriting numbers are Chinese and English line accuracy, which stays around 50–68%.
- The Latin v5 mobile model is 7.5 MB, but its handwriting quality on German is unmeasured.
- PP-OCRv6_medium (34.5M parameters, about 73 MB ONNX fp32, 46 Latin languages) is the strongest candidate as a complement, mainly for print/mixed script and detection.

### Cited Findings
- **PP-OCRv5 recognition accuracy** (official in-house benchmark):

  | Model | Handwritten English | Handwritten Chinese | Printed English |
  |---|---|---|---|
  | PP-OCRv5_server_rec | 0.5806 | 0.5807 | 0.8679 |
  | PP-OCRv5_mobile_rec | 0.4944 | 0.4166 | 0.8753 |
  | PP-OCRv4_server_rec | 0.2661 | — | — |
  | PP-OCRv4_mobile_rec | 0.2550 | — | — |

  — [PP-OCRv5 docs](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html)
- **PP-OCRv5 handwriting detection** (English Hmean): server 0.841 vs 0.249 for v4 server; mobile 0.777. — [PP-OCRv5 docs via search snippet](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html)
- **PaddleOCR 3.0 Technical Report:** PP-OCRv5 cuts the recognition error rate on non-standard handwriting (Chinese + English combined) by 26%. — [arXiv 2507.05595](https://arxiv.org/pdf/2507.05595)
- **PP-OCRv6:**
  - Family of 1.5M–34.5M parameters (medium = 34.5M).
  - Small and medium cover 50 languages in one model: zh-Hans, zh-Hant, English, Japanese, plus 46 Latin-script languages. Tiny covers 49 (no Japanese).
  - The page does not name German explicitly.
  - Handwriting accuracy:

    | Model | Handwritten English | Handwritten Chinese |
    |---|---|---|
    | v6_medium | 67.8 | 62.1 |
    | v6_small | 61.1 | 57.6 |
    | v6_tiny | 39.3 | 40.1 |
    | v5_server | 59.6 | 58.0 |
    | v5_mobile | 50.9 | 41.7 |

  - Release date and license are not stated on that page. — [PP-OCRv6 docs](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)
- **Latin PP-OCRv5 mobile ONNX** (`latin/latin_PP-OCRv5_mobile_rec.onnx` + `ppocrv5_latin_dict.txt`):
  - Listed at 7.5 MB with 84.7% accuracy (test set unspecified); covers French, German, Spanish and others.
  - Intended for RapidOCR. Use v5 detection with v5 recognition. — [monkt/paddleocr-onnx](https://huggingface.co/monkt/paddleocr-onnx)
- **One downstream config** describes the Latin model's training data as "3,111 Latin script images". Unclear and unverified. — [camstack config](https://huggingface.co/camstack/camstack-models/blob/main/plateRecognition/paddleocr/onnx/config.json)
- **mxaln/docscanner-ocr** (Apache-2.0, on-device app):
  - Ships `PP-OCRv5_mobile_det` (4.6 MB) plus a `ppocrv6` recognizer exported from `PP-OCRv6_medium_rec` via paddle2onnx: float32, opset 16, about 73 MB.
  - Self-reported per-line CER on handwritten pages after detection: English (neat) 5–7%, English (hard hand) about 14%, Spanish/French about 4%. Cyrillic handwriting reached 76–84% CER with PaddleOCR recognizers.
  - Small informal samples, not mapped to model versions. — [mxaln/docscanner-ocr](https://huggingface.co/mxaln/docscanner-ocr)
- **ppu-paddle-ocr** (npm):
  - Has a `/web` entry using `onnxruntime-web`; works in browsers, extensions and Web Workers; WebGPU when available.
  - Default models are fetched and cached on first run; custom models are supported.
  - Its README claims the official SDK is "browser-only and significantly slower" (author's claim, unverified). — [ppu-paddle-ocr README](https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.0.0/README.md), [GitHub](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
- **Official browser SDK:** `@paddleocr/paddleocr-js` runs the PP-OCR pipeline client-side. — [PaddleOCR browser deployment](https://www.paddleocr.ai/main/en/version3.x/inference_deployment/cross_platform/browser.html)

### Inferences
- The PaddleOCR "accuracy" figures are line-level exact-match-like accuracy on in-house sets, not CER, so they are not directly comparable with naeyn's 8% CER. The docscanner informal 4–7% CER on neat Spanish/French/English handwriting suggests v6_medium could be competitive with naeyn on neat German writers, but this is unverified.
- Best use in the plugin:
  - PP-OCRv5 detection (4.6 MB) for page/region segmentation, which naeyn requires and does not provide.
  - A Latin/v6 recognizer as a second engine for printed or mixed lines, IPv6 addresses and subnet masks (its dictionary includes digits, colons and slashes), replacing Tesseract.js (43% CER) as the final fallback.
  - Hand off to naeyn for cursive lines.
- Ink Blocks renders strokes on a clean background, so detection should be easy. The "3,111 Latin images" note, if accurate, implies very little Latin handwriting in the v5 Latin model's training data.

### Gaps
- No published CER of any PaddleOCR model on German handwriting (ScaDS, fhswf) was found. A local benchmark on the ScaDS test writers would settle this.
- The PP-OCRv6 license and release date are not on the docs page. Prior PaddleOCR models are Apache-2.0, and the docscanner export inherits Apache-2.0.
- No WASM latency numbers for PP-OCRv6_medium were found. 73 MB fp32 single-threaded could be slow; int8 quantization quality is unknown.
- Whether the PP-OCRv6 charset contains ß/ä/ö/ü was not verified; it presumably does for 46 Latin languages.

## 4. Other frameworks and research models: docTR/OnnxTR, Surya, Kraken/Party, Transkribus/PyLaia, HTR-VT, HTR-ConvText, SimpleHTR, others

### Takeaway
None is a ready drop-in. Each fails on at least one constraint:
- **Transkribus Text Titan:** closed and paid.
- **Surya:** non-commercial license, 470M parameters.
- **Party:** 858 MB PyTorch, page-wise.
- **gigapdf handwriting CRNN:** PolyForm Noncommercial.
- **docTR/OnnxTR:** printed text.
- **HTR-VT / HTR-ConvText:** research checkpoints without ONNX or German modern data.

The only truly open, small, ONNX handwriting models found besides naeyn are SimpleHTR from xournalpp-htr (English IAM, word-level, MIT) and its word detector.

### Cited Findings
- **docTR in the browser (2022, older):** TF.js demo with MobileNetV2 DB detection + CRNN recognition, aimed at printed documents. — [TF blog 2022](https://blog.tensorflow.org/2022/06/ocr-in-browser-using-tensorflowjs.html)
- **OnnxTR:** ONNX wrapper around docTR with 8-bit quantized models. — [onnxtr PyPI 0.4.0](https://pypi.org/project/onnxtr/0.4.0)
- **docTR model zoo:**
  - `Felix92/doctr-torch-parseq-multilingual-v1`: 12 languages, Apache-2.0, 47.9 MB PyTorch, no ONNX seen. — [HF tree](https://huggingface.co/Felix92/doctr-torch-parseq-multilingual-v1/tree/main)
  - `Felix92/onnxtr-parseq`: model.onnx 96.6 MB, English/French. — [HF tree](https://huggingface.co/Felix92/onnxtr-parseq/tree/main)
- **Surya:**
  - Weights are cc-by-nc-sa-4.0, with a commercial waiver below $5M revenue/funding (one README copy also requires not competing with the Datalab API).
  - Recognition model `vikp/surya_rec2` has 470M parameters. — [surya README mirror](https://github.com/pyNpy/surya-ocr), [vikp/surya_rec2](https://huggingface.co/vikp/surya_rec2)
- **Party (Kraken successor, B. Kiessling, EPHE-PSL), "Party model for European languages" v1 (Jun 2025):**
  - Page-wise recognizer for print and handwriting in 26 languages including German.
  - Swin encoder + tiny Llama decoder (about 100M parameters, octet tokenization).
  - `party_european_langs.safetensors` 858.1 MB, Apache-2.0.
  - Mostly historical training data. No CER reported. "Intended to be fine-tuned" on the target data. — [Zenodo 15764161](https://zenodo.org/records/15764161)
- **Transkribus Text Titan I/II:**
  - Platform-only "super models" for Latin-script print + handwriting including German.
  - Only "Open in Transkribus"; access via paid credits; not downloadable or fine-tunable. — [Text Titan II](https://www.transkribus.org/models/text-titan-ii), [Transkribus blog](https://blog.transkribus.org/en/introducing-transkribus-super-models-get-access-to-the-text-titan-i?hsLang=en)
- **Transkribus public PyLaia models** (e.g. "German handwriting M1", ID 35909, CER 4.70 reported) also run on the platform. PyLaia itself is open source (jpuigcerver/PyLaia). — [search summary citing Transkribus model pages](https://www.transkribus.org/models/german-lower-german-latin-17th-century)
- **Academic source:** "Transkribus' platform is open source, but its models are not." — [Benchmarking LLMs for HTR (arXiv 2503.15195)](https://arxiv.org/pdf/2503.15195)
- **HTR-VT (2024, older):**
  - Encoder-only ViT with CNN patch embedding, SAM optimizer and span mask. Code at github.com/YutingLi0606/HTR-VT.
  - IAM 4.7 CER / 14.9 WER; 53.5M parameters as reported in the HTR-ConvText comparison table. — [HTR-VT arXiv 2409.08573](https://arxiv.org/pdf/2409.08573), [HTR-ConvText arXiv 2512.05021](https://arxiv.org/pdf/2512.05021)
- **HTR-ConvText** (DAIR-Group, Dec 2025):
  - ResNet-18 + MobileViT hybrid, encoder-only CTC, about 65.9M parameters, Apache-2.0, no ONNX on the card.
  - CER: IAM 4.0%, READ2016 (historical German) 3.6%, LAM 2.7%, HANDS-VNOnDB 3.45%. — [DAIR-Group/HTR-ConvText](https://huggingface.co/DAIR-Group/HTR-ConvText)
- **xournalpp-htr SimpleHTR** (PellelNitram):
  - Word-level CRNN (5 CNN layers, 2 BiLSTM, CTC), about 3.2M parameters, ONNX, MIT.
  - Trained on IAM: validation CER 5.6%, word accuracy 84.2%.
  - Companion ONNX word detector `xournalpp-htr-word-detector` (also MIT; the HF list shows an `-rf-detr` variant updated Sep 2026). — [xournalpp-htr-simple-htr](https://huggingface.co/PellelNitram/xournalpp-htr-simple-htr), [HF search](https://huggingface.co/models?search=htr&sort=modified)
- **gigapdf-ocr-handwriting:**
  - Line-level CRNN-CTC (2-layer BiLSTM-256), height 32, dynamic-width ONNX (opset 17) plus a `.rten` file.
  - Latin/Cyrillic/Greek, trained on about 108k real lines (IAM, RIMES, NorHand, NewsEye, Belfort, POPP, Esposalles) plus synthetic lines.
  - No CER reported. License: **PolyForm Noncommercial 1.0.0** — fine for private use, but not "open" for redistribution in a public plugin. — [ronylicha/gigapdf-ocr-handwriting](https://huggingface.co/ronylicha/gigapdf-ocr-handwriting)

### Inferences
- **HTR-ConvText / HTR-VT:** CTC encoder-only, so they would export to ONNX cleanly. But at 54–66M parameters (about 4–6× naeyn), and with no modern German weights, they would need retraining on ScaDS + fhswf. Possible upside: IAM CER of 4.0–4.7 vs the CRNN class around 5–8%, so a German retrain might beat naeyn's 8%. That is a project, not a download.
- **SimpleHTR:** could complement naeyn for English IT terms, but its IAM alphabet lacks umlauts/ß and it is word-level.
- **Party:** the most capable open multilingual option, but at 858 MB with an autoregressive Llama decoder it is out of budget for WASM.

### Gaps
- Not researched due to the tool-call budget: EasyOCR (latin_g2 recognizer — printed, not handwriting, per prior knowledge, unverified), MMOCR, HTR-Flor, DTrOCR, OrigamiNet, Riksarkivet (Swedish historical TrOCR line models exist per HF search hits), Teklia (PyLaia/DAN models for historical French), `Kansallisarkisto/multicentury-htr-model` (seen in the HF list, details unchecked). Their licenses, German capability and ONNX status remain unverified.
- No browser latency figures for any of these.

## 5. Datasets of modern German handwriting for fine-tuning

### Takeaway
There are two usable modern German line datasets: ScaDS.AI (775 writers, over 42k words + lines, CC BY 4.0) and fhswf/german_handwriting (about 10.9k lines, 15 writers, AFL-3.0). naeyn v2 already uses both. Domain adaptation (IT terms, IPv6, subnet masks, print/mixed script) therefore has to come from the user's own Ink Blocks lines, which the plugin can collect with their stroke→text corrections, or from synthetic rendering. Note that synthetic pretraining did not help naeyn.

### Cited Findings
- **ScaDS.AI German Line- and Word-Level Handwriting Dataset:** handwritten Wikipedia excerpts from 775 anonymous writers in German-speaking regions (about half an A4 page, about 15 lines / 220 words each), over 42,000 words and lines. DOI 10.5281/zenodo.18301532. — [ScaDS.AI article (Apr 14, 2026)](https://scads.ai/open-data-for-german-handwriting-recognition/)
- **ScaDS.AI German Full-Page Handwriting Dataset:**
  - 77 pages; about 19 scans have truncated characters; CC BY 4.0.
  - VLM benchmark on it: all models CER < 5% / WER < 12%, best GPT-4o CER < 3% (cloud VLMs, for reference only). — [ScaDS.AI article](https://scads.ai/open-data-for-german-handwriting-recognition/), [Zenodo 18283705](https://zenodo.org/records/18283705)
- **fhswf/german_handwriting:** about 10,854 rows (single split, 1.8 GB Parquet), 15 writers, from school/university transcripts, AFL-3.0, widths 42–4,280 px. No baseline CER on the card. — [HF dataset](https://huggingface.co/datasets/fhswf/german_handwriting)
- **CVL Database** (310 writers, German + English) is listed by a commercial aggregator. Unverified; check the original source and license. — [LXT handwriting datasets](https://www.lxt.ai/datasets/handwriting/)
- **Historical-only sets** (not suitable for the modern domain): Kurrent 19th c. (9,317 lines, Zenodo Oct 2025) and READ2016 (Early Modern German). — [Zenodo 17252677](https://zenodo.org/records/17252677), [HTR-ConvText paper](https://arxiv.org/pdf/2512.05021)

### Inferences
- The fhswf set has only 15 writers, so it is easy to overfit; naeyn uses it only as auxiliary data. Fine-tuning naeyn on a few hundred of the user's own corrected lines (same ResNet18-BiLSTM-CTC, re-export int8) is the most direct way to fix IT terms. The 112-symbol alphabet must already contain ':' '/' and hex digits; check `config.json`.
- Ink Blocks has the stroke data, so lines rendered from real strokes at varying pen widths are near-real data, unlike font-rendered synthetic data.

### Gaps
- License of CVL and any other modern German sets (e.g. a German subset of IAM-like collections) not verified.
- No dataset of German handwritten technical/IT notation was found.

## 6. Benchmarks comparing these on modern German handwriting

### Takeaway
I found no head-to-head benchmark of small open models (naeyn, PaddleOCR, TrOCR, PyLaia/Kraken) on modern German handwriting. The available numbers are not comparable:
- naeyn 8.0% CER on 78 unseen ScaDS writers
- fhswf TrOCR-large 4.1% on its own 15-writer split
- Transkribus "German handwriting M1" CER 4.70 (platform, test data unknown)
- Cloud VLMs < 3–5% on ScaDS full pages

### Cited Findings
- **Crosilla et al.** (arXiv 2503.15195, Mar/Jun 2025) compare proprietary/open LLMs with Transkribus models on English, French, German and Italian, modern and historical data. Transkribus did better on German and multilingual datasets, while LLMs did better on modern handwriting in other languages (e.g. GPT-4o-mini IAM CER 1.71%). The search snippets did not give the German per-table numbers. — [arXiv 2503.15195](https://arxiv.org/pdf/2503.15195)
- **Zach (HAW Hamburg BA thesis, Jul 2025):** HTR-VT trained on IAM (English) vs on fhswf/german_handwriting (German), tested cross-lingually. Performance drops clearly across languages even with CTC. Recommends multilingual training or language-specific adaptation. CER values are not in the abstract. — [HAW REPOSIT](https://reposit.haw-hamburg.de/handle/20.500.12738/19399?locale=en)
- **ScaDS.AI VLM benchmark** on the full-page set: CER < 5% for all tested VLMs, GPT-4o < 3%. — [ScaDS.AI article](https://scads.ai/open-data-for-german-handwriting-recognition/)
- **naeyn v1 vs v2** on the same 78-writer test: 8.61% → 8.01% CER. — [de-htr-web-v2 card](https://huggingface.co/naeyn/de-htr-web-v2)

### Inferences
- The thesis result implies that English-trained handwriting models (TrOCR-handwritten, SimpleHTR, IAM-trained HTR-VT) will degrade on German text. This supports keeping a German-trained model as primary and using English or multilingual models only as a fallback or second opinion.
- A small local benchmark is needed and is cheap: the 601-line ScaDS test split naeyn uses plus a few dozen of the user's own IT-term lines, run through naeyn v2, PP-OCRv5 Latin mobile, PP-OCRv6 small/medium, TrOCR-small (Xenova) and Tesseract.

### Gaps
- No German-language figures from the Crosilla benchmark tables were retrieved.
- No published CER for PaddleOCR, docTR, EasyOCR or TrOCR-small on ScaDS or fhswf.
