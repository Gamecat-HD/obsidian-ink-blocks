# Accuracy boosters for a small CTC HTR model (de-htr-web-v2) inside an Obsidian plugin

Scope: improvements that keep the model `naeyn/de-htr-web-v2` and run in JS/TS/WASM (Electron, Web Worker, onnxruntime-web). Research date 2026-10-17.

Model facts that matter for all sections (from the model card, [HF: naeyn/de-htr-web-v2](https://huggingface.co/naeyn/de-htr-web-v2)):
- ResNet18 stem (to layer3), 3 stacked BiLSTM-256, CTC head. About 10.06M parameters, 10.4 MB int8 ONNX. 112 symbols: blank plus 111 characters. Characters outside the set, such as curly quotes, cannot be emitted.
- Input: grayscale, height 64, aspect ratio kept, right-padded with white to a width that is a multiple of 4, pixels in [0,1]. Normalization happens inside the model. Dynamic width up to 1024. Stride 4.
- Trained from scratch only on real handwriting: ScaDS.AI German line/word crops (CC BY 4.0) and fhswf/german_handwriting. No synthetic data.
- 8.01% CER and 32.3% WER (int8, greedy) on 601 lines from 78 held-out writers. Error varies a lot by writer.
- The card documents greedy decoding only and says a domain lexicon or LM rescoring could reduce word errors.
- The ScaDS.AI set comes from 775 handwritten Wikipedia transcripts of about 15 lines each, giving more than 42,000 word and line crops ([ScaDS.AI](https://scads.ai/open-data-for-german-handwriting-recognition/)). In other words, the training data is ink on paper, not online ink.

## 1. CTC beam search with an LM / lexicon in JS (libraries, gains, vault LM, OOV such as IP addresses)

### Takeaway
LM- and lexicon-constrained CTC decoding is the biggest, cheapest win. HTR literature reports 20–45% relative CER reduction and much larger WER reduction (WER often halves). The gain depends strongly on how closely the lexicon/LM matches the text, and the user's own vault is close to the best case. No maintained JS/npm decoder with an LM exists. The practical route is a ~300–600 line TS port of CTC prefix beam search plus Word Beam Search (WBS) logic, with an n-gram LM built from the vault in TS. IP addresses and numbers go through the WBS "non-word" state or a small regex/FSA.

### Cited Findings
**Gains reported in the literature**
- Word Beam Search paper (Scheidl, Fiel, Sablatnig, ICFHR 2018), Table I, same CRNN output for every decoder. Format is CER% / WER% / ms per line:
  - IAM:
    - best path 8.77 / 29.07 / 12
    - vanilla beam search (VBS, BW=15) 8.48 / 28.24 with the generic LM text, 8.27 / 27.34 with the test-set LM text
    - WBS Words mode (dictionary only), BW=50: 8.25 / 23.67 (generic, 373k words) and 4.86 / 10.15 (in-domain, 3,707 words)
    - WBS N-grams mode, BW=15, in-domain: 5.33 / 9.77 / 56 ms
  - Bentham:
    - best path 5.60 / 17.06
    - WBS Words mode, BW=50, in-domain: 3.73 / 7.50
  - The LM uses add-k smoothing with k=0.01. In-domain text is the best case (zero OOV). The generic case is the training text plus a 370k-word list. The authors say real results fall in between. — [Scheidl et al. 2018 PDF](https://repositum.tuwien.at/retrieve/1835)
- In the same paper, with the generic large lexicon, N-grams mode made IAM CER *worse* (10.00 vs 8.77), while WER still improved (23.88 vs 29.07). Forecast modes cost 16,388 ms per line with the 373k-word dictionary but 786–1,040 ms with the small one. Raising WBS beam width from 15 to 50 improved CER by up to 0.76 points and took about 3x longer. VBS barely benefits from beam widths above 15. — [Scheidl et al. 2018](https://repositum.tuwien.at/retrieve/1835)
- Google online HWR (Carbune et al. 2020), BLSTM-CTC on curves:
  - German internal validation CER: 7.12 → 5.43 with a character n-gram LM (−24% relative), 5.36 with character classes, 5.40 with a word LM. English: 8.00 → 6.54.
  - IAM-OnDB test with feature functions (LM etc.): CER 5.9 → 4.0, WER 18.6 → 10.6. IBM-UB-1: CER 6.0 → 4.1, WER 25.1 → 15.1.
  - LMs: 7-gram character LM with Stupid back-off, pruned to 10M n-grams; 3-gram word LM. Decoder weights were tuned with Bayesian optimisation on a separate dataset.
  - Small side effects: the word LM *raised* Hindi CER (7.32 → 7.42), and the char LM slightly raised Korean CER.
  - [Carbune et al., arXiv 1902.10525](https://ar5iv.labs.arxiv.org/html/1902.10525)
- A comparison table in an IAM seq2seq paper lists a CNN-BLSTM-CTC at 5.8% CER without an LM and 4.4% with one (IAM-A partition). — [arXiv 1903.07377 via search summary](https://arxiv.org/pdf/1903.07377)
- CNN-BiLSTM-CTC on IAM (2023) used WBS with beam 150, a 2-gram word LM, and an 82k-word lexicon (IAM train + Brown + WikiText-2, 0.13% OOV). It reached 3.46% val CER / 11.70% WER before TTA. — [arXiv 2307.00664](https://arxiv.org/html/2307.00664v1)

**Algorithm details useful for a TS port**
- Prefix beam search keeps two scores per prefix: the probability of paths ending in blank and of paths ending in non-blank. A repeated character may only extend from the blank-ending part. LM fusion maximises p(Y|X) · p(Y)^α · L(Y)^β, where β is an insertion bonus. The LM is applied only when a prefix is extended, and α and β are set by cross-validation. — [Hannun, Distill 2017](https://distill.pub/2017/ctc/)
- WBS builds a prefix tree (trie) from the dictionary, so each beam's next characters are limited to valid word continuations. It allows any non-word characters (numbers, punctuation) between words and needs a word-separator character such as space. Modes are Words, NGrams, NGramsForecast and NGramsForecastAndSample, at O(1), O(log W), O(W log W) and O(W) LM cost respectively. — [CTCWordBeamSearch README](https://github.com/githubharald/CTCWordBeamSearch); [Scheidl et al. 2018](https://repositum.tuwien.at/retrieve/1835)
- Token passing (the classic dictionary decoder) is quadratic in dictionary size and cannot decode arbitrary strings such as numbers. That is why WBS added a non-word state. — [Scheidl et al. 2018](https://repositum.tuwien.at/retrieve/1835)

**Libraries (JS/WASM availability)**

| Library | Language / license | LM support | Use for this project |
|---|---|---|---|
| CTCWordBeamSearch | C++/Python, MIT, last push 2026-01-31 | Dictionary + word n-grams | No JS/WASM port; reference for a TS port or an Emscripten build |
| CTCDecoder | Python, MIT, last push 2026-01-31 | Char-LM beam search, lexicon search; also best path, token passing, prefix search | Easy to transliterate to TS |
| pyctcdecode | Python, Apache-2.0, last push 2023-07 | KenLM shallow fusion (alpha/beta), hotwords with `hotword_weight` (example 10.0) | Design reference only (Python) |
| npm `ctc-beam-search` | JS, Apache-2.0, v0.1.0, unchanged since 2022 | None ("doesn't support NGram now") | Not usable for LM decoding |
| ds2-tfjs | tfjs + partial WASM | CTC decoder with N-gram LM | Proof the pattern works in a browser |
| sherpa-onnx | Apache-2.0, very active (push 2026-10-17) | Hotwords documented for transducer `modified_beam_search`; no WASM n-gram/hotword CTC path found | ASR-specific; not a drop-in HTR decoder |
| KenLM | NOASSERTION in GitHub API | n-gram LM | No WASM build found |

Sources for the table:
- [CTCWordBeamSearch](https://github.com/githubharald/CTCWordBeamSearch); [CTCDecoder](https://github.com/githubharald/CTCDecoder) (licenses and activity from the GitHub API)
- [pyctcdecode](https://github.com/kensho-technologies/pyctcdecode)
- [npm ctc-beam-search](https://www.npmjs.com/package/ctc-beam-search)
- [ds2-tfjs](https://github.com/yhwang/ds2-tfjs)
- sherpa-onnx: [hotwords guide](https://www.mintlify.com/xdcobra/react-native-sherpa-onnx/guides/hotwords); [WASM demo](https://k2-fsa-web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc.static.hf.space/index.html)
- KenLM: [KenLM paper](https://www.kheafield.com/papers/avenue/kenlm.pdf); a search found no WASM port

### Inferences
- **Expected gain for this model:** the vault is the user's own notes, so it sits between Scheidl's "Te" (in-domain) and "Tr+L" (generic) settings, likely nearer Te for recurring terms. A realistic estimate is CER 8% → about 5–6% and WER 32% → about 15–20%, mostly from fixing whole words. This is extrapolated from the IAM/Bentham/German numbers above and has to be confirmed on the user's corrected pairs.
- **Effort:** a TS prefix beam search with a char n-gram is about 1–2 days. Adding WBS-style trie constraints with a non-word state is about 2–4 days. Everything runs in the existing worker on the `[1,T,112]` logits. Cost at T≈250 and beam 16–32 is a few ms to tens of ms per line, judging from Scheidl's 56–90 ms in C++ including the network.
- **Recommended architecture: hybrid word + char.**
  - Do log-space prefix beam search (beam 16–32) over the logits.
  - Use a **character 5–7-gram LM** (Kneser-Ney or Stupid back-off, as Google did) trained on the vault text and stored as a compact JSON/typed-array trie. This gives a smooth score for any string, including OOV words and German compounds.
  - Add a **word unigram/bigram bonus** (pyctcdecode-style partial-word check against a vault trie) instead of a hard WBS dictionary constraint. Hard constraints failed with a big generic lexicon (CER got worse) and would block new words. A soft bonus degrades gracefully.
  - Add **hotwords**: IT terms from the vault (e.g. "Subnetzmaske", "IPv6", "DHCP", "OSI-Schicht") plus words from the user's past corrections, at a higher weight.
  - Tune α (LM weight) and β (insertion bonus) by grid search on the user's (strokes, corrected text) pairs. Carbune et al. and pyctcdecode both stress per-domain tuning.
- **IP addresses, subnet masks, numbers:**
  - Treat them as a "non-word" class in which the LM is switched off or replaced by a tiny grammar. Model them as a finite-state acceptor over characters: IPv4 octets `25[0-5]|2[0-4]\d|1?\d?\d` with dots; IPv6 hex groups with `:`/`::`; CIDR `/\d{1,3}`; masks `255.255.x.x`.
  - When a beam enters a state that matches the start of such a pattern (a digit after a space, or "fe80:"), score it with the FSA (allowed vs disallowed next character) instead of the char LM. This is how WBS lets "arbitrary non-word strings" through, generalised to a grammar.
  - Also restrict characters inside numeric tokens to hex digits plus `.:/`. That removes common O/0, l/1 and S/5 confusions.
  - A cheap first version: run greedy and beam decodes, regex-validate candidate IP tokens from the N-best list, and pick the best valid one.
- **Vault LM build:** tokenize all `.md` files in the worker. Strip front-matter, code blocks (optionally), URLs and markdown syntax. Lowercase-fold only for the word bonus and keep case for the char LM, since the model emits case. Count n-grams. Incremental updates on file change are cheap. Size at 7-gram order is easily a few MB, so prune to n-grams seen at least twice. The user's notes also include the model charset, so map characters outside the 111-char set (e.g. typographic quotes) to their ASCII forms before counting.
- **Overall ranking across all questions:**
  1. Beam search + vault char-LM + hotwords + IP grammar: biggest gain, moderate effort.
  2. Render-parameter tuning against the training distribution: cheap and possibly large.
  3. Confidence flagging: cheap, improves UX rather than CER.
  4. TTA with 3–5 renderings: moderate gain at 3–5x compute.
  5. Head/last-layer personalization in pure JS: medium effort, gain grows with corrections.
  6. LLM post-correction: high risk, optional.

### Gaps
- No HTR paper reports gains for an LM built from a single user's personal notes. The closest reference points are Scheidl's "Te" (zero-OOV) best case and writer-specific LMs mentioned in [Kohút et al.](https://arxiv.org/pdf/2302.06308), with no numbers extracted.
- No published, maintained JS/WASM port of CTCWordBeamSearch, pyctcdecode or KenLM was found, so building one is self-implementation.
- No German-specific figures for compound handling in lexicon decoding were found.

## 2. Test-time augmentation (TTA) / ensembling with multiple renderings

### Takeaway
TTA gives moderate, consistent gains: about 0.4–0.8 CER points and 1.8–2.6 WER points on IAM with 17 variants, chosen by optical score plus LM. An oracle pick shows much larger headroom (CER 4.80 → 3.02). Because the plugin renders the strokes itself, it can produce clean, controlled variants. Variants that keep image width (stroke width, mild blur or thickness) allow cheap frame-wise logit averaging. Variants that change geometry (slant, scale) need hypothesis-level combination (N-best rescoring or ROVER/confidence voting).

### Cited Findings
- CNN-BiLSTM-CTC on IAM: 16 shear/rotation augmentations plus the original give up to 17 transcriptions. Each is scored as λ·optical score (from WBS) + ω·LM score (4-gram KenLM on WikiText-103), and the best is kept.

  | Setting | Test CER / WER without TTA | With TTA | Oracle pick |
  |---|---|---|---|
  | Case-sensitive | 4.80 / 13.85 | 4.37 / 12.03 | 3.02 / 9.35 |
  | Case-insensitive, no punctuation | 4.38 / 12.00 | 3.59 / 9.44 | not extracted |

  [arXiv 2307.00664](https://arxiv.org/html/2307.00664v1)
- Related work cited there: one group applied 36 transformations at test time and averaged the model outputs. Another used 20 transformations and picked the transcription with the lowest CTC loss. — [arXiv 2307.00664 (search summary)](https://arxiv.org/pdf/2307.00664)
- Confidence voting (Calamari/OCR4all) pools each voter's per-character probabilities after alignment, rather than a majority vote on top-1 strings. Results:
  - UW3: CER 0.155% → 0.114% (−26% relative).
  - DTA19 German Fraktur: 0.221% → 0.184%.
  - Reul et al. (as cited secondarily): up to and over 50% CER reduction on early printed books, and confidence voting gave 5–10% more than ISRI sequence voting.
  - These are *model* ensembles (5 cross-fold voters), not input TTA.
  - [Calamari, arXiv 1807.02004](https://arxiv.org/pdf/1807.02004); [DHQ](https://digitalhumanities.org/dhq/vol/14/2/000451/000451.html); [arXiv 1802.10033](https://arxiv.org/pdf/1802.10033)
- No source was found that specifically measures multi-scale CTC posterior averaging for HTR. — (search found none; see Gaps)

### Inferences
- **Expected gain:** about 5–15% relative CER with 3–8 rendering variants, judging from 2307.00664's 9–18% relative test CER reduction with 17 variants. Gains from input TTA should be smaller than from model ensembles (Calamari's 26–50%), because one model's errors stay correlated across renderings.
- **Cost:** N variants = N forward passes. With an int8 10M-parameter model on WASM SIMD, 3–5 variants per line is likely acceptable in a background worker (not measured here).
- **Variant design:**
  - *Same geometry*: stroke width (e.g. 0.8x, 1x, 1.3x of a base width), anti-aliasing or blur, gray level. T stays the same, so average the **log-softmax frame by frame** (or the probabilities) and then run a single beam search with the LM. This is the cheapest combination.
  - *Different geometry*: slant ±5–10°, height-normalisation variants (x-height targets), horizontal scale ±10%. T differs, so decode each variant to an N-best list with the LM. Then rescore by summed CTC log-likelihood (run a CTC forward pass of each candidate string over *each* variant's logits, which is the "lowest CTC loss" criterion above) plus the LM score. Alternatively, use ROVER-style alignment and confidence voting over the 1-best strings.
- **Recommended:** CTC forward rescoring across variants. It needs no string alignment, uses the same CTC forward code as the confidence and fine-tuning parts, and reflects all variants' evidence.
- **Effort:** same-width logit averaging about 0.5 day. Cross-variant N-best rescoring about 1–2 days once beam search exists.

### Gaps
- No published numbers for TTA on *rendered online ink* or for stroke-width variants specifically.
- No measured runtime for de-htr-web-v2 in onnxruntime-web WASM per line, so the cost of N variants is an estimate.

## 3. Stroke-level preprocessing for rendered online ink

### Takeaway
The model was trained only on real ink-on-paper line images (grayscale, white background, height 64). The most important lever is therefore making the rendered strokes *look like* that data: stroke thickness relative to x-height, gray anti-aliased ink, sensible padding, and a consistent body height. Classic online-HWR normalisation helps make renderings consistent: resample to equal distance, smooth or Bézier-fit, normalise baseline and size, correct slant. Literature gives no ready-made "best stroke width" for this model, so it should be tuned empirically on the user's corrected pairs.

### Cited Findings
- Input contract: grayscale, resized to height 64 with aspect kept, right-padded *white* to a multiple of 4, [0,1] range, max width 1024. Training data is only real handwriting lines and word crops (ScaDS.AI, fhswf). — [model card](https://huggingface.co/naeyn/de-htr-web-v2)
- Google online HWR preprocessing:
  - Shift x so x₀=0. Scale the writing area so y spans [0,1]; if the area is unknown, use a surrogate area 20% larger than the observed ink.
  - Resample strokes linearly at equidistant steps (δ=0.05, so 20 points per unit length).
  - Fit cubic Bézier curves per stroke by least squares, splitting when the fit error is too large or the arc length exceeds 3x the endpoint distance.
  - Curves gave no significant accuracy difference versus raw points. They were used for a 4x shorter input and up to 10x speed.
  - [Carbune et al. 2020](https://ar5iv.labs.arxiv.org/html/1902.10525)
- Kohút et al. found that Geometry augmentation, NoiseBlurGamma and Masking clearly improved fine-tuning, while Color had almost no effect. Geometry changes "affected the writing style significantly" but still helped, so the model family is sensitive to geometric and stroke appearance. — [Kohút et al., arXiv 2302.06308](https://arxiv.org/pdf/2302.06308)

### Inferences
These are engineering recommendations without direct literature numbers.
- **Resample and smooth** strokes (equidistant points, light Gaussian or Chaikin smoothing, or Bézier) before rasterising. This removes digitiser jitter, which scanned training data never had.
- **Height normalisation:**
  - Estimate core (x-height) and baseline by robust regression over stroke points, e.g. median of local minima for the baseline and the 80th percentile of local maxima for the median line.
  - Rotate to deskew the baseline. Scale so the core height is about 40–50% of 64 px, so that ascenders and descenders fit like in cropped training lines.
  - Avoid scaling by full bounding box: one tall letter or long descender would shrink the whole line.
  - The right ratio should be checked by measuring sample crops from the ScaDS/fhswf data.
- **Slant:** estimate the dominant near-vertical stroke angle (histogram of segment angles weighted by length) and shear to about 0°. Optionally render the measured slant ±δ as TTA variants (section 2).
- **Stroke width:** render with round caps/joins, anti-aliased, in dark gray (not pure black) on white, so the result looks like ballpoint scans. Pen pressure can modulate width slightly.
  - Choose the width by grid search: render the user's corrected samples at e.g. 1.5/2/2.5/3/3.5/4 px (at 64 px line height) and pick the lowest-CER setting. This is the cheapest experiment with potentially large impact.
  - Expose it as a hidden setting with an "auto-calibrate" button.
- **Padding:** add a few px of white margin on the left and right. Avoid extreme widths: lines over 1024 px after scaling must be split at large gaps between strokes, not squashed.
- **Line segmentation** from ink: use stroke y-centroids and time order. Wrong splits cost more than any rendering detail.

### Gaps
- No published analysis of optimal rendered stroke width for an offline HTR model fed with online ink, and no measured stroke-width statistics for ScaDS.AI/fhswf crops. These have to be measured locally.
- No source quantified the CER effect of slant or baseline normalisation for this kind of model.

## 4. On-device personalization from (strokes, corrected text) pairs

### Takeaway
Writer adaptation by fine-tuning works very well for CTC HTR. Kohút et al. report average relative CER reductions of 25% with 16 lines and 50% with 256 lines, with augmentation adding about 10 points. Fine-tuning the *whole* network beats adapting selected layers. However, onnxruntime-web's training submodule was **removed after 1.19.2**: it is present in 1.19.2 and absent in 1.20.0 and the current 1.30.0. It also never shipped a CTC loss. In 2026 the practical in-plugin route is therefore pure-JS training of the CTC output layer (optionally plus a small adapter) on features exported from the ONNX model. The alternative is pinning a legacy onnxruntime-web 1.19.2 training build with a custom CTC-loss graph, which is risky.

### Cited Findings
**Gains from writer adaptation**
- Kohút et al.:
  - Average relative CER improvement of 25% with 16 adaptation lines and 50% with 256 lines.
  - At 64 lines: fine-tuning without augmentation reduced CER by 25%; all basic augmentations added about 10% more.
  - Fine-tuned models outperformed the baseline for most writers and did not worsen any (64-line runs).
  - With 1–8 lines, a static-iteration setup still improved most writers but overfitted two.
  - Easy-to-read, source-like scripts gained less (up to 10%), and with few lines overfitting made results worse (up to 15%).
  - Best optimal-iteration-to-lines ratios were 180, 90, 60, 38, 33, 30, 24, 15 and 9 for 1, 2, 4, 8, 16, 32, 64, 128 and 256 lines (S3 strategy).
  - The base model was a CNN + BiLSTM CTC network, fine-tuned entirely with Adam.
  - [arXiv 2302.06308](https://arxiv.org/pdf/2302.06308)
- Related work summarised by Kohút et al.:
  - Aradillas et al.: fine-tuning the whole network beats fine-tuning selected layers.
  - Kohút et al. (earlier): learning new writer-dependent parameters was worse than fine-tuning all parameters.
  - Speech (Liao): adapting the input layer beat adapting the output layer, and adapting all layers was best.
  - Overfitting regularisation via a KL divergence to the original model's outputs (Yu et al.).
  - Bhunia et al.: meta-learned models adapt in one step from 16 word images.
  - Soullard et al.: writer-specific LMs further improved results.
  - [arXiv 2302.06308](https://arxiv.org/pdf/2302.06308)
- A WACV 2025 workshop paper compares LoRA and full fine-tuning for HTR. Its full text was not retrievable (HTTP 403), so no numbers were extracted. — [Huttner et al., WACVW 2025](https://openaccess.thecvf.com/content/WACV2025W/VISIONDOCS/papers/Huttner_Low-Rank_Adaptation_vs._Fine-Tuning_for_Handwritten_Text_Recognition_WACVW_2025_paper.pdf)

**Status of onnxruntime-web training**
- Web training shipped in ORT 1.17 as `onnxruntime-web/training`. It ran on CPU/WASM only, single-threaded, and needed artifacts (training model, optimizer model, checkpoint, optional eval model) generated offline in Python. — [Microsoft Open Source blog, 2024-02-06](https://opensource.microsoft.com/blog/2024/02/06/on-device-training-training-a-model-in-browser)
- ORT 1.20.0: "All ONNX Runtime Training packages have been deprecated"; 1.19.2 was the last training release. — [ORT v1.20.0 release](https://github.com/microsoft/onnxruntime/releases/tag/v1.20.0)
- Checked directly from the published `package.json` files: the `./training` export is present in onnxruntime-web 1.19.2 and absent in 1.20.0 and in the current latest, 1.30.0. — [unpkg onnxruntime-web@1.19.2/package.json](https://unpkg.com/onnxruntime-web@1.19.2/package.json); [unpkg onnxruntime-web@latest/package.json](https://unpkg.com/onnxruntime-web@latest/package.json)
- The web training examples repo (MNIST demo) was archived on 2026-05-20. — [onnxruntime-training-examples/on_device_training/web](https://github.com/microsoft/onnxruntime-training-examples/tree/master/on_device_training/web)
- `generate_artifacts` supports only the losses MSE, CrossEntropy, BCEWithLogits and L1, or a custom `onnxblock.Block`. CTC is not built in. The workaround is to put the loss inside the exported forward graph. — [ORT training artifacts docs](https://www.onnxruntime.ai/docs/api/python/on_device_training/training_artifacts.html)
- The current onnxruntime JS API reference lists only `InferenceSession`, `Tensor` and `Env`, and nothing about training. — [ORT JS API](https://onnxruntime.ai/docs/api/js/index.html)
- The CTC forward recursion (alpha over the blank-extended label sequence, computed in log space) is simple to implement. — [Distill CTC](https://distill.pub/2017/ctc/)

### Inferences
- **Option A, recommended: train the CTC head in pure TS.**
  - Re-export the ONNX model (offline, once) with an extra output: the last BiLSTM features `[1,T,512]`. In the worker, cache features for every corrected sample.
  - Train only the final linear layer (512×112 + bias, about 57k parameters), or a small residual adapter (512→32→512) plus the head. Use the CTC loss and gradient written in TS. The standard Graves (2006) gradient with respect to the logits is softmax − (normalized α·β occupancy); this is a known result, not taken from a source fetched here.
  - Train with Adam, few epochs, and a KL or L2 penalty to the original head weights (the "stay close" regularisation of Yu et al.). Early stopping uses the iterations-to-lines ratios of Kohút et al. as a prior.
  - It runs in milliseconds per step on CPU. Store the learned head as a small file in the plugin data and apply it as a JS matmul after the ONNX features, or by patching the initializer.
  - Augmentation is cheap and matters per Kohút et al.: re-render each correction with different stroke widths, slant and scale. Features must be recomputed per render, which needs an ONNX pass but no backprop through the encoder.
  - Expected gain is likely well below Kohút's full-fine-tuning numbers, because the literature says full > selected layers and input-side adaptation > output-side. Still positive for systematic confusions; it needs local validation.
- **Option B, risky: legacy ORT web training.**
  - Pin `onnxruntime-web@1.19.2/training` in a separate worker. Build artifacts offline in Python 1.19.x with CTC inside the graph via a custom onnxblock or torch export. The int8 model would need an fp32 trainable copy.
  - Downsides: an unmaintained runtime, single-threaded speed, and an extra ~10 MB+ WASM binary. A frozen-encoder setup is advisable even here.
- **Option C: full fine-tuning in TF.js or a hand-written WASM autograd.** This means reimplementing ResNet18 + BiLSTM training. Too much effort for the plugin; better done offline by the user in Python if ever.
- **Cheaper personalization that needs no gradients:**
  - (a) Add every corrected word to the hotword/lexicon list with higher weight.
  - (b) Tune α, β and the rendering stroke width on the corrections.
  - (c) Learn a per-user character confusion prior from (greedy output, correction) alignments and use it as a small bias in beam search.
  - (d) Calibrate confidence thresholds (section 5).
  - These start paying off from the first corrections.
- **Sample counts:** literature suggests visible gains from about 16 lines and strong gains toward 64–256 lines for full fine-tuning. With head-only training, wait until about 30–50 corrected lines and always keep a held-out 20% for regression checks. Automatically reject a new head if held-out CER gets worse.
- **Data hygiene:** use only lines whose correction was explicitly confirmed. Treat untouched recognized text as *weak* labels, since keeping errors in training reinforces them.

### Gaps
- No numbers were found for *head-only* or adapter-only CTC HTR writer adaptation. The WACVW 2025 LoRA-vs-FT paper was inaccessible.
- No 2026 roadmap or issue was found that announces a replacement for onnxruntime-web training.
- No source covers int8 to fp32 handling for on-device fine-tuning of this specific model.

## 5. Confidence estimation from CTC posteriors

### Takeaway
Word-level confidence from CTC can be computed cheaply in the worker from the logits and the decoded alignment. Useful signals are per-frame max probability, normalised entropy, or the beam/N-best score margin. In speech, entropy-based aggregation detects errors up to 2x better than max-probability. Calibration against the user's corrections, such as one temperature or a logistic regression, turns these scores into a reliable "uncertain word" highlight.

### Cited Findings
- Laptev & Ginsburg (NVIDIA) normalise and aggregate per-frame entropy into per-unit and per-word confidences for CTC and RNN-T. On LibriSpeech they report up to 2x better error detection than maximum per-frame probability for Conformer-CTC. — [arXiv 2212.08703](https://arxiv.org/pdf/2212.08703)
- Naowarat et al. (Interspeech 2023) add confidence estimation modules to CTC models, using surrounding-word context. They report lower calibration error than raw CTC softmax confidence for both common and rare words. — [ISCA archive](https://www.isca-archive.org/interspeech_2023/naowarat23b_interspeech.html)
- A 2026 preprint notes word-level calibration remains weaker than token-level because top-K features are absent, and uses beam-search information to improve confidence. — [arXiv 2607.29299](https://arxiv.org/html/2607.29299v1)
- Word-level calibration is evaluated with normalised cross-entropy (NCE) and expected calibration error (ECE). — [arXiv 2110.03327](https://arxiv.org/pdf/2110.03327)
- Classic HTR computes word posteriors from word graphs or N-best lists and thresholds them to flag words for human review in interactive transcription. — [Confidence Measures for Error Correction in Interactive Transcription (ResearchGate)](https://www.researchgate.net/publication/221355940_Confidence_Measures_for_Error_Correction_in_Interactive_Transcription_Handwritten_Text)
- Confusion networks / consensus decoding give word posteriors from N-best lists or lattices. — [Mangu et al., arXiv cs/0010012](https://arxiv.org/pdf/cs/0010012)

### Inferences
- **Implementation (about 0.5–1 day):**
  - Get frame spans per output character from the greedy path, or from beam back-pointers. Per word, compute min and mean of max-prob over the word's non-blank frames, plus mean normalised entropy (H/log C).
  - From the beam N-best, compute word posterior ≈ sum of exp(scores) of hypotheses containing the same word at that position, divided by the total. This is a cheap confusion-network approximation.
  - Add "LM disagreement": the greedy word differs from the LM-decoded word. Add "OOV vs vault lexicon" and "TTA disagreement": the variants disagree on the word.
- **Calibration:** fit a logistic regression on the user's corrections (label: was the word changed) over these 4–6 features. Until enough data exists, use a fixed entropy threshold.
- **UX:** underline low-confidence words in the `text:` field and offer the top 3 alternatives from the N-best. Picking an alternative is a correction that also feeds hotwords and personalization.
- **Calibration of the model itself:** one temperature T on the logits, fitted on corrections, also improves beam-search mixing with the LM (α interacts with T).

### Gaps
- No HTR-specific CTC confidence-calibration paper with numbers was found. Evidence is from speech recognition and older non-CTC HTR.

## 6. Optional: small in-browser LLM for post-correction (risks)

### Takeaway
LLM post-correction can reduce HTR CER by up to about 30% in benchmarks, but results vary widely with model and prompt. Open and small models do worse than closed ones. Hallucinated "fixes" are a documented failure mode, and for a non-English language results can be not practically useful. For IT notes with IP addresses and exact terms, the risk of silent semantic changes is high. Any use should be constrained (only on low-confidence spans, only choosing among N-best candidates, or scoring rather than generating) and opt-in.

### Cited Findings
- An LLM post-correction study on Washington, Bentham and IAM reports CER reductions of up to 30%, with large variation by prompt and model. — [HES-SO arodes record 15161](https://arodes.hes-so.ch/record/15161)
- On BRESSAY/RIMES/IAM (Portuguese, French, English), closed LLMs reduced CER/WER more than open models. — [STIL 2025 (SBC)](https://sol.sbc.org.br/index.php/stil/article/download/37859/37637)
- On BRESSAY, smaller fine-tuned language models beat LLaMA models at reducing errors and were cheaper. — [NeurIPS-W 2024 proposal](https://mlanthology.org/neuripsw/2024/dearaujo2024neuripsw-proposal)
- Handwritten code recognition: the LLM post-corrector hallucinated unrequested indentation changes and logic "fixes". The authors needed strict no-change instructions and a 3-step chain-of-thought. — [arXiv 2408.07220](https://arxiv.org/pdf/2408.07220)
- An LLM HTR benchmark notes that self-correction has given clear gains in OCR but not in HTR. — [arXiv 2503.15195](https://arxiv.org/pdf/2503.15195)
- Historical OCR: LLM post-correction helped English, but Finnish results were not practically useful ("No free lunches"). — [arXiv 2502.01205](https://arxiv.org/html/2502.01205v1)

### Inferences
- **Size cost:** a small instruction model (0.5–1.5B, 4-bit) in WebGPU/WASM adds hundreds of MB to over 1 GB of download and RAM, and seconds of latency per line. That is disproportionate next to a 10 MB recognizer, and ruled out on weak laptops.
- **Safer use:** use the LLM as a *scorer* over the decoder's N-best candidates for low-confidence spans (shallow fusion / rescoring), never as a free generator. Skip it entirely for tokens matched by the IP/number grammar. This keeps outputs within what the optical model supports.
- **Cheaper alternative:** a stronger vault-trained char/word n-gram LM (section 1) gives most of the "context" benefit at near-zero cost and cannot hallucinate. Prefer it unless corrections show remaining semantic errors.
- **German results:** given the Finnish result, LLM gains on German IT jargon should not be assumed without local testing on the user's corrected pairs.

### Gaps
- No study found that evaluates *small, in-browser* LLMs for HTR post-correction, or German HTR post-correction specifically.
- No quantitative over-correction rates for HTR post-correction were found.
