# Online (stroke-based) handwriting recognition for Ink Blocks: inventory and feasibility (as of 2026-10-17)

Scope: recognizers that read pen trajectories (x, y, t, pressure) directly and could run inside an Obsidian plugin (Electron renderer / Web Worker, onnxruntime-web WASM or WebGPU, or pure JS/WASM), compared against the current offline pipeline (naeyn/de-htr-web-v2, CTC ONNX, about 8% CER).

## Q1: Which open-source pretrained online recognizers exist for Latin script / German?

### Takeaway
No ready-to-use, openly licensed, pretrained **German** online line recognizer exists. The usable open checkpoints are English-only models trained on IAM-OnDB, which has no umlauts or ß and a non-commercial data license. The best of them is PellelNitram/OnlineHTR: MIT code, PyTorch, a Carbune et al. re-implementation with downloadable IAM-OnDB weights. The other "classic" open toolkits (Lipi Toolkit, Zinnia/Tegaki, CellWriter-style template matchers) recognize isolated characters, or only CJK, and are not competitive for line-level German or IT text.

### Cited Findings
**Usable neural checkpoints (English, IAM-OnDB)**
- **PellelNitram/OnlineHTR**: PyTorch (Lightning + Hydra) re-implementation of Carbune et al.'s LSTM online HTR. MIT license. Pretrained weights can be downloaded (`dataIAMOnDB_featuresLinInterpol20DxDyDtN_decoderGreedy`). Trained only on IAM-OnDB. Input is strokes resampled to 20 points per unit length with channels (dx, dy, dt, n=new-stroke flag). Greedy CTC decoder. No CER reported, no ONNX export mentioned. — [GitHub OnlineHTR](https://github.com/PellelNitram/OnlineHTR)
- The same author maintains **xournalpp_htr**, a GPL-2.0 handwritten-text-recognition plugin for Xournal++. It is early stage (v0.1, shipped `enabled=false`) and Python/PyTorch based. — [GitHub xournalpp_htr](https://github.com/PellelNitram/xournalpp_htr); [HF Space plugin.ini](https://huggingface.co/spaces/PellelNitram/xournalpp_htr/blob/main/plugin/plugin.ini)
- **chunkyjasper/IAMhwr**: online HTR on IAM-OnDB with TDNN + RNN layers. Pretrained weights are included (`models/iamon/ONNET/pretrained-deep-lstm`). Reports 6.2% CER on IAM-OnDB independent-writer task 2 using a pruned 5-gram character LM (Google 1B corpus) plus a lexicon. The README does not state a license or framework. 27 stars, small project. — [GitHub IAMhwr](https://github.com/chunkyjasper/IAMhwr)
- I found **no** ready-made ONNX checkpoint for stroke-based HTR in the ONNX model zoo or on Hugging Face. Handwriting entries there are MNIST digits or detection models only. — [onnx/models](https://github.com/onnx/models); [us4/handwritten-detector-onnx](https://huggingface.co/us4/handwritten-detector-onnx)
- I found no TF.js or ORT-Web browser demo of stroke-input LSTM-CTC recognition. The browser handwriting demos found were digit CNNs or Graves-style generation. The closest browser-HTR artifact is the offline DE·HTR model the plugin already uses (9.84 MB int8 ONNX, greedy CTC, line images). — [DE·HTR v2](https://huggingface.co/naeyn/de-htr-web-v2); [DE·HTR](https://huggingface.co/naeyn/de-htr-web)

**Classic open toolkits**
- **Lipi Toolkit** (HP Labs India): open-source *online* HWR toolkit. Its alphanumeric recognizer covers English uppercase, lowercase and digits as isolated characters. Qt Virtual Keyboard bundles LipiTk 4.0.0 under the MIT license (copyright HP 2006/2017). — [LipiTk](https://lipitk.sourceforge.net/lipi-toolkit.htm); [Qt attribution](https://doc.qt.io/qt-5/qtvirtualkeyboard-attribution-lipitk.html)
- **Zinnia**: SVM-based online character recognizer that takes stroke coordinates and has a training module. Tegaki ships Zinnia models only for Japanese, Simplified Chinese and Traditional Chinese, derived from the Tomoe project. — [Fedora zinnia](https://packages.fedoraproject.org/pkgs/zinnia/zinnia); [tegaki-zinnia-japanese](https://community.linuxmint.com/software/view/tegaki-zinnia-japanese); [DragonFly pkg-descr](https://gitweb.dragonflybsd.org/dports.git/blob/56891b844ff6c8059163f108397d8c75a2c2e9f1:/japanese/zinnia/pkg-descr)
- **handwriting.js** (ChenYuHo): only a wrapper around Google IME's unofficial cloud endpoint (Input Tools), so it is excluded because it is cloud. — [handwriting.js](https://git.tdem.in/ChenYuHo/handwriting.js); [labnol write-up](https://www.labnol.org/code/19205-google-handwriting-api)

**Proprietary / vendor engines (not usable)**
- reMarkable's handwriting conversion is "powered by MyScript" (paid; already rejected). — [reMarkable features](https://remarkable.com/products/remarkable-paper/pro/details/features)
- Boox and Supernote have conversion, but I found no source naming their engines. — [productivematters substack](https://productivematters.substack.com/p/how-i-convert-handwritten-notes-to)
- **FUTO Keyboard**: I found no handwriting feature. FUTO Swipe is open swipe-typing models (summary from a third party), and the keyboard code is under the "FUTO Source First License 1.1", which is source-available, not OSI open source. — [futo-org/android-keyboard](https://github.com/futo-org/android-keyboard); [FUTO Swipe summary](https://chatgate.ai/post/futo-swipe)
- **Rnote**: no evidence of ink-to-text recognition. — [Chrome Unboxed on Rnote](https://chromeunboxed.com/google-curs)

### Inferences
- OnlineHTR is the most practical starting point for code and architecture. Porting it to ONNX should be straightforward: a small BiLSTM with CTC, and onnxruntime-web supports LSTM ops. Its released weights are English-only, though, and would need retraining or fine-tuning for ä/ö/ü/ß and IT symbols.
- Weights trained on IAM-OnDB inherit the dataset's research-only terms (see Q4), which matters if the plugin is ever distributed publicly with those weights.
- None of the open checkpoints is likely to beat the current offline model on German out of the box. Carbune et al. show that a model trained only on IAM-OnDB generalizes badly to diverse real-world ink (31.2% CER on Google's internal set, Q3).

### Gaps
- No CER for OnlineHTR's released checkpoint. License, framework and last update for IAMhwr are not stated on the README.
- Did not verify Windows Ink (`InkRecognizer`, Windows-only native API) or Apple/Samsung on-device engines. These are platform-locked and closed, and irrelevant on Linux/Electron in any case.

## Q2: Is Google ML Kit Digital Ink usable without Google Play / cloud, or in a web/WASM build? What is the model licensing?

### Takeaway
ML Kit Digital Ink runs on-device and offline once its model is downloaded, but only through the Android and iOS SDKs. There is no web, WASM or desktop SDK. The terms forbid reverse engineering or extracting the models, so pulling a model out for the Obsidian plugin is both unsupported and non-compliant.

### Cited Findings
- Digital Ink runs on-device without a network connection after the model download. It covers 300+ languages and 25+ writing systems, plus shape and emoji classifiers (2020 blog, older info). — [Google Developers Blog](https://developers.googleblog.com/2020/08/digital-ink-recognition-in-ml-kit.html)
- Digital Ink supports **only** the "dynamically downloaded" installation path: no bundled models, and not unbundled via Play Services. Models are stored in app storage and managed through RemoteModelManager. The docs cover Android and iOS only, and web is not mentioned. — [ML Kit installation paths](https://developers.google.com/ml-kit/tips/installation-paths)
- Downloaded models are a packaged archive that is unzipped on first use. — [iOS DigitalInkRecognitionModel reference](https://developers.google.com/ml-kit/reference/swift/mlkitdigitalinkrecognition/api/reference/Classes/DigitalInkRecognitionModel)
- ML Kit terms: "you may not reverse engineer or attempt to extract the source code or any related software", and ML models count as related software. ML Kit also sends performance and usage metrics to Google. The CC-BY/Apache labels on the docs cover only the docs and samples, not the models. — [ML Kit Terms](https://developers.google.com/ml-kit/terms); [reference page license footer](https://developers.google.com/ml-kit/reference/swift/mlkitdigitalinkrecognition/api/reference/Classes/DigitalInkRecognitionModel)
- No source describes a working web or WASM port or an extractable `.tflite`. — [search: Android guide](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android)

### Inferences
- Not viable for the plugin: Android/iOS-only binaries, model downloads from Google servers, telemetry, and a ToS ban on extraction. This also conflicts with the "no cloud" constraint, because the model fetch goes through Google.

### Gaps
- Whether the Play Services dependency is strictly required on Android (de-Googled devices) was not confirmed. This is moot for a desktop Electron plugin.

## Q3: What is the Chromium Handwriting Recognition API's status in 2026 outside ChromeOS (re-verification)?

### Takeaway
Re-verified: no evidence of support outside ChromeOS. The API was specified (WICG draft dated 9 July 2025) and shipped for ChromeOS around Chromium 99. The original intent stated that Linux has no OS recognizer to back it, so Electron on Linux will not have it.

### Cited Findings
- Intent to Ship (December 2021) covered ChromeOS only. The Intent to Prototype said Linux "doesn't have a built-in handwriting recognition library we can integrate with". — [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/s3n3bGl6i1M/m/-WWoNcZTDAAJ); [Intent to Prototype](https://groups.google.com/a/chromium.org/g/blink-dev/c/VXUq1UY4m7Y)
- The WICG spec draft is dated 9 July 2025 and defines `navigator.createHandwritingRecognizer` and `queryHandwritingRecognizer`. — [WICG spec](https://wicg.github.io/handwriting-recognition/)
- Chrome developer docs (last updated 2024-10-30) say the API is available "from Chromium 99". The ChromeOS implementation recognizes one language at a time and supports only English plus a gesture model. — [Chrome for Developers](https://developer.chrome.com/docs/web-platform/handwriting-recognition)
- Google's sample page reports "not supported on this platform" on unsupported OSes. — [sample](https://googlechrome.github.io/samples/handwriting-recognition/)

### Inferences
- Even on ChromeOS it is English-only, so it would not help German anyway. Keep it rejected. A feature-detect (`'createHandwritingRecognizer' in navigator`) costs nothing if the plugin wants to future-proof.

### Gaps
- chromestatus.com did not render through the fetch tool, so the per-OS status for 2026 could not be read directly. No blink-dev post newer than 2021 about other platforms was found.

## Q4: Which 2024–2026 research models and datasets are relevant, and do any have released weights?

### Takeaway
The strongest recent results come from Google (Carbune et al. 2019/2020; Fadeeva et al. 2024 "Representing Online Handwriting for Recognition in Large VLMs"), but Google released **no** recognizer weights. The only released Google ink model is InkSight Small-p (Apache-2.0, TensorFlow, ViT + mT5). It derenders images to ink; it is not a lightweight ink-to-text recognizer. Public online datasets are English-centric and mostly non-commercial. The one German online source, Fraunhofer OnHW, is IMU-sensor data from a sensor pen, not tablet x/y, except for a small "wordsTraj" subset.

### Cited Findings
**Reference architecture: Carbune et al., "Fast Multi-language LSTM-based Online Handwriting Recognition" (IJDAR 2020, arXiv 1902.10525; older but still the reference)**
- Production system covers 102 languages, including German. Input is Bézier-curve encoding (10 features), or raw input (5 features), followed by 3–5 BiLSTM layers and a softmax layer, trained with CTC. Decoding is CTC beam search with a 7-gram character LM and a 3-gram word LM. Up to 10x faster than their earlier segment-and-decode system. — [arXiv 1902.10525](https://arxiv.org/abs/1902.10525)
- IAM-OnDB test CER: 5x64 BiLSTM with curve input gives 5.9% without feature functions (LM etc.) and 4.0% with them. The production system trained on in-house data, with no IAM-OnDB training, gives 2.5% CER / 6.5% WER. Raw and curve inputs reach about the same accuracy, and "64 nodes per layer is sufficient". — [arXiv 1902.10525 (PDF, Tables 2–3)](https://arxiv.org/pdf/1902.10525)
- Cross-dataset CER (Table 8): trained on IAM-OnDB, tested on IAM-OnDB 3.8%, on IBM-UB-1 35.1%, on Google's own diverse set 31.2%. Trained on Google's own set: 3.3% / 4.8% / 8.7%. The authors attribute the gap to sloppy writing, overlapping characters, nonuniform sampling and rotation in real-world data. — [arXiv 1902.10525 (PDF)](https://arxiv.org/pdf/1902.10525)

**Fadeeva et al. 2024 (Google Research), "Representing Online Handwriting for Recognition in Large Vision-Language Models" (arXiv 2402.15307)**
- Ink is fed to VLMs as a text-token stroke sequence plus a rendered image. CER on public data (lower is better):
  - DeepWriting: PaLI 4.39%, CTC-transformer baseline 5.71%, Carbune production 6.14%
  - VNOnDB: PaLI 3.04%, MyScript 2.91%
  - MathWriting: PaLM-E 4.19%, CTC-transformer baseline 4.28%
  — [arXiv 2402.15307 HTML](https://arxiv.org/html/2402.15307)
- **The small CTC-transformer baselines are 9M (DeepWriting), 15M (VNOnDB) and 35M (MathWriting) parameters**, trained on public data only. The VLMs are about 500–700M parameters. No weights or code are released. — [arXiv 2402.15307 HTML](https://arxiv.org/html/2402.15307)

**InkSight (Google, arXiv 2402.05804, TMLR 2025)**
- Converts *photos* of handwriting into digital ink (offline-to-online "derendering"). Uses ViT + mT5 and tokenizes ink with 2 tokens per point (x, y) over a 2N+3 vocabulary with N=224. Small-p weights are released on Hugging Face (Apache-2.0 tag) for TensorFlow 2.20, with no ONNX or web export. The inference code relies on external OCR (docTR, Tesseract). — [GitHub google-research/inksight](https://github.com/google-research/inksight); [HF InkSight-Small-p](https://huggingface.co/Derendering/InkSight-Small-p/commits/main); [arXiv 2402.05804](https://arxiv.org/html/2402.05804v4)

**Other 2025–2026 papers (no confirmed weights)**
- Lodh et al., arXiv 2506.20255 (June 2025): early fusion of image patches with an (x, y, pen) stroke transformer through learnable latent queries. Claims state-of-the-art on IAMOnDB and VNOnDB by "up to 1%". The abstract mentions code, but the link did not come through in the fetch and no weights are mentioned. — [arXiv 2506.20255](https://arxiv.org/abs/2506.20255)
- Generation-side work (useful only for synthetic data): DiffInk (arXiv 2509.23624), BoundInk (arXiv 2604.02103), and trajectory recovery from images (arXiv 2609.02251). — [DiffInk](https://arxiv.org/pdf/2509.23624); [BoundInk](https://arxiv.org/pdf/2604.02103); [Trajectory recovery](https://arxiv.org/pdf/2609.02251)
- Self-supervised online-handwriting representation (POSM, trained on IAM-OnDB): no release found. — [arXiv 2310.06645](https://arxiv.org/pdf/2310.06645)

**Datasets**
- **IAM-OnDB**: 221 writers, 86,272 words, 11,059-word dictionary, mostly printed English text lines. Standard split is 5,363 train / 1,438 + 1,518 val / 3,859 test lines. — [arXiv 1902.10525 (PDF)](https://arxiv.org/pdf/1902.10525). Access requires registration (noted in the [OnlineHTR README](https://github.com/PellelNitram/OnlineHTR)). The IAM databases are free for **non-commercial research** with registration (the statement is for the offline IAM DB; the IAM-OnDB page itself could not be fetched because its TLS certificate has expired). — [IAM download page](https://fki.tic.heia-fr.ch/databases/download-the-iam-handwriting-database)
- **BRUSH** (Brown): 27,649 online samples from 170 writers, English, non-commercial research only. — [Papers with Code BRUSH](https://paperswithcode.com/dataset/brush); [decoupled-style-descriptors](https://github.com/brownvc/decoupled-style-descriptors)
- **IBM-UB-1**: predominantly cursive English single words, plus multilingual sets. — [CUBS IBM-UB](https://cubs.buffalo.edu/HWdata/); [arXiv 1902.10525](https://arxiv.org/pdf/1902.10525)
- **MathWriting** (Google DeepMind 2024): 230k human + 400k synthetic online math expressions in InkML (2.9 GB). The license appears to be CC BY-NC-SA 4.0, unconfirmed at the README. Digits, operators and symbols here could help with IT/number content. — [arXiv 2404.10690](https://arxiv.org/html/2404.10690v2)
- **DeepWriting** (ETH) and **VNOnDB** (Vietnamese) are used as benchmarks by Fadeeva et al. — [arXiv 2402.15307](https://arxiv.org/html/2402.15307)
- **Fraunhofer OnHW** (STABILO DigiPen): OnHW-chars has 31,275 English letters from 119 writers, IMU at 100 Hz (accelerometers, gyroscope, magnetometer, force). — [Fraunhofer OnHW page](https://www.iis.fraunhofer.de/de/ff/lv/dataanalytics/anwproj/schreibtrainer/onhw-dataset.html); [hackster](https://www.hackster.io/news/onhw-has-useful-written-all-over-it-8780293653ce)
  - The word sets OnHW-words500 (25,218 samples) and OnHW-wordsRandom (14,641 samples, German + English word list, up to 27 labels) contain German labels with umlauts. OnHW-wordsTraj adds tablet (Wacom EMR) and camera ground-truth trajectories and was recorded in Germany. — [arXiv 2202.07036](https://arxiv.org/pdf/2202.07036); [IJDAR 2022](https://link.springer.com/article/10.1007/s10032-022-00415-6); [arXiv 2202.07901](https://arxiv.org/pdf/2202.07901)
  - Direct ZIP downloads are available with no stated license (only "please cite"). — [Fraunhofer OnHW page](https://www.iis.fraunhofer.de/de/ff/lv/dataanalytics/anwproj/schreibtrainer/onhw-dataset.html)

### Inferences
- Nothing in 2024–2026 offers a downloadable, browser-sized, German-capable online recognizer. The research value is architectural evidence: Google's best public-data numbers come from small CTC models (BiLSTM 5x64, or 9–35M CTC transformers) or from much larger ink+image VLMs.
- OnHW's German word data is mostly IMU signals and is not directly reusable for tablet x/y input. Only the small wordsTraj subset (two persons per the download page) has x/y trajectories.

### Gaps
- No German **tablet-trajectory** dataset of meaningful size with a permissive license was found.
- The IAM-OnDB license text could not be fetched (expired certificate). The DeepWriting license was not checked.
- Whether arXiv 2506.20255 really publishes code or weights is unverified.

## Q5: Is training our own small online CTC model realistic, with synthetic data, model size and expected CER?

### Takeaway
The model side is realistic and the browser cost is trivial. A Carbune-style 5x64 BiLSTM-CTC (OnlineHTR code) is roughly 0.4–0.5M parameters (my estimate), and small CTC transformers of 9–35M parameters are documented. The bottleneck is **German and IT training data**. Public trajectories are English and non-commercial, and Google's own results show that a model trained only on IAM-OnDB degrades to about 31% CER on diverse real-world ink. Expect IAM-OnDB-level CER (4–6%) only on clean data that resembles the training data. Reaching under 8% CER on the user's own German and IT notes would need synthetic data and/or a personal dataset harvested from the plugin's own corrected notes.

### Cited Findings
- 64 nodes per BiLSTM layer is sufficient, and 3–5 layers beat shallower nets with little gain beyond. Raw (dx, dy, dt, pen) input is about as accurate as Bézier input; Bézier input is mainly faster because sequences are shorter. — [arXiv 1902.10525 (PDF)](https://arxiv.org/pdf/1902.10525)
- OnlineHTR provides the full training pipeline (IAM-OnDB loader, feature extraction, PyTorch Lightning training, pretrained weights) under MIT. This is the closest existing "tutorial/repo that does exactly this". — [GitHub OnlineHTR](https://github.com/PellelNitram/OnlineHTR)
- A CTC transformer of 9M parameters reaches 5.71% CER on DeepWriting from public data only. — [arXiv 2402.15307](https://arxiv.org/html/2402.15307)
- Synthetic data helps a lot:
  - Apple's "Data Incubation" trains a controllable handwriting synthesizer and uses its samples to fill content and style gaps, reporting a 66% CER reduction versus real data alone. — [arXiv 2110.07040](https://arxiv.org/pdf/2110.07040)
  - Sigma-lognormal synthesis of online handwriting from a few real samples improved recognition in Bhattacharya et al. — [ISI digital commons](https://digitalcommons.isical.ac.in/journal-articles/2438)
- Graves-style handwriting synthesis toolkits exist in PyTorch (trained on IAM-OnDB, so English alphabet). — [pytorch-handwriting-synthesis-toolkit](https://github.com/X-rayLaser/pytorch-handwriting-synthesis-toolkit)
- MathWriting combined 230k human samples with 400k synthetic ones, showing that Google itself relies on synthetic ink for symbol-heavy content. — [arXiv 2404.10690](https://arxiv.org/html/2404.10690v2)
- I found no published work specifically using Hershey or single-line fonts to synthesize stroke training data. The nearest analogue renders word *images* from fonts (Krishnan & Jawahar, 9M images). — [arXiv 1608.04224](https://arxiv.org/pdf/1608.04224.pdf)

### Inferences
- **Size and runtime:** a 5x64 BiLSTM needs about 0.4–0.5M parameters (my estimate). It would be under 2 MB as fp32 ONNX and run in milliseconds per line on single-thread WASM. Even a 9M transformer is about the size of the current offline model.
- **A plausible data recipe** (not validated):
  1. Pretrain on IAM-OnDB + BRUSH + MathWriting (research-only licenses, so fine for personal use but problematic for redistributing weights).
  2. Generate synthetic German and IT lines (umlauts, ß, IPv6 hex groups, "/24" masks, colons) from single-line or Hershey fonts with per-glyph jitter, slant, speed and pressure noise, or from a synthesis model fine-tuned with umlaut glyphs composed from base letters plus dot strokes.
  3. Fine-tune on the user's own strokes. The plugin already stores strokes and can collect labels whenever the user corrects OCR output; this personal adaptation is likely the biggest win.
- **Expected accuracy:** without real German handwriting data, an online model will probably *not* beat the current 8% CER offline model on the user's notes. Carbune's cross-domain table shows how fragile academic-only training is. The online route becomes attractive once a few thousand of the user's own labeled lines exist.
- IT strings (IPv6, masks) are not word-like, so LM/lexicon decoding helps less. A custom character LM or regex-aware beam search (hex groups separated by `:`) may matter as much as the model.

### Gaps
- No public figure for German online-HTR CER from open models.
- No tested single-line-font synthesis pipeline for German. Real effectiveness is unknown.
- Training compute was not quantified. A model this small should train on one consumer GPU, but no source confirms that for this setup.

## Q6: Hybrid approaches — combining online features with the rendered image

### Takeaway
Published evidence consistently shows that ink + image beats either modality alone. The cheapest practical hybrid for the plugin is **late fusion**: run the existing offline model and a small online CTC model on the same line, then pick or rescore hypotheses (CTC beam rescoring, or confidence-based selection per line). The 2025 early-fusion transformer approach would require training from scratch.

### Cited Findings
- MathWriting CER, Fadeeva et al. (Google):
  - PaLI: image-only 8.07%, ink-only 4.64%, ink+image 4.55%
  - PaLM-E: image-only 4.87%, ink-only 6.46%, ink+image 4.22%
  - When the ink sequence exceeds the context length, adding the image lowers CER from 17.38% to 11.17%.
  — [arXiv 2402.15307 HTML](https://arxiv.org/html/2402.15307)
- Lodh et al. 2025 early fusion (image-patch tokens plus a stroke transformer, joined by latent queries) claims state-of-the-art on IAMOnDB and VNOnDB. — [arXiv 2506.20255](https://arxiv.org/abs/2506.20255)
- Auxiliary cross-modal representation learning between image and online (IMU) data for online HWR (Ott et al., Fraunhofer). It notes that no image-based German dataset with umlauts exists for pairing. — [arXiv 2202.07901](https://arxiv.org/pdf/2202.07901)
- Carbune's production system already combines CTC with character and word LMs through feature functions, which cut IAM-OnDB CER from 5.9% to 4.0%. — [arXiv 1902.10525 (PDF)](https://arxiv.org/pdf/1902.10525)

### Inferences
- The strokes are already available, so stroke data can improve the *current* offline pipeline without a new recognizer:
  - Use time order and stroke gaps for line and word segmentation.
  - Detect delayed strokes (umlaut dots, i-dots, t-bars).
  - Render with pressure and normalized slant before feeding the offline model.
  These are low-risk gains compared with training a new model.
- A late-fusion ensemble (offline DE-HTR plus an online BiLSTM fine-tuned on the user's data) costs little extra runtime.

### Gaps
- No open-source hybrid ink+image recognizer with weights was found.
- No source quantifies late-fusion gains for German.
