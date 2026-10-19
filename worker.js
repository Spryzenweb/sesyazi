// Tüm ağır iş burada: model yükleme, cümlelere bölme, dil tespiti, yazıya dökme.
// Mac'teki ses2text.py ile aynı mantık.
import {
  AutoProcessor,
  WhisperForConditionalGeneration,
  Tensor,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;
// çok çekirdek sadece sayfa izole ise mümkün (bkz. sw.js)
if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);

const SR = 16000;
const MAX_CHUNK = 28;   // Whisper penceresi 30 sn
const MIN_PAUSE = 0.35; // bu kadar sessizlik = cümle sınırı
const MIN_LANG = 1.5;   // bundan kısa parçada dil tespiti güvenilmez

const MODELS = {
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
  turbo: 'onnx-community/whisper-large-v3-turbo',
};

let loaded = null; // { key, processor, model }

const post = (type, data = {}) => self.postMessage({ type, ...data });

async function pickDevice() {
  if (!self.navigator?.gpu) return { device: 'wasm' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { device: 'wasm' };
    return { device: 'webgpu', f16: adapter.features.has('shader-f16') };
  } catch {
    return { device: 'wasm' };
  }
}

function dtypeFor(key, dev) {
  if (dev.device === 'wasm') return 'q8';
  if (key === 'turbo') return { encoder_model: 'q4', decoder_model_merged: 'q4' };
  return { encoder_model: dev.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' };
}

async function load(key, cpuOnly = false) {
  if (loaded?.key === key) return loaded;
  loaded = null;
  const id = MODELS[key];
  const files = new Map(), started = new Set(), finished = new Set();
  const progress_callback = (p) => {
    if (p.status === 'initiate') started.add(p.file);
    if (p.status === 'done') {
      finished.add(p.file);
      if (finished.size === started.size)
        post('status', { text: 'Model başlatılıyor (1-2 dk sürebilir)...', progress: 1 });
    }
    if (p.status === 'progress' && p.total) {
      files.set(p.file, [p.loaded, p.total]);
      let a = 0, b = 0;
      for (const [l, t] of files.values()) { a += l; b += t; }
      post('status', { text: `Model indiriliyor: ${(a / 1e6).toFixed(0)} / ${(b / 1e6).toFixed(0)} MB`, progress: a / b });
    }
  };
  post('status', { text: 'Model hazırlanıyor...', progress: 0 });
  const processor = await AutoProcessor.from_pretrained(id, { progress_callback });

  // iPad'de WebGPU bellek yüzünden takılabiliyor; orada CPU kullan
  let dev = cpuOnly ? { device: 'wasm' } : await pickDevice();
  let model;
  try {
    model = await WhisperForConditionalGeneration.from_pretrained(id, {
      device: dev.device, dtype: dtypeFor(key, dev), progress_callback,
    });
  } catch (e) {
    if (dev.device !== 'webgpu') throw e;
    dev = { device: 'wasm' }; // WebGPU olmadı, CPU ile devam
    model = await WhisperForConditionalGeneration.from_pretrained(id, {
      device: 'wasm', dtype: 'q8', progress_callback,
    });
  }
  loaded = { key, processor, model, device: dev.device };
  post('status', { text: `Model hazır (${dev.device === 'webgpu' ? 'GPU' : 'CPU'})`, progress: 1 });
  return loaded;
}

function splitUtterances(audio) {
  const hop = (SR * 30) / 1000, step = 0.03;
  const n = Math.floor(audio.length / hop);
  if (n === 0) return [[0, audio.length / SR]];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += audio[j] * audio[j];
    db[i] = 10 * Math.log10(s / hop + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const pct = (q) => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))];
  const thresh = Math.max(pct(0.2) + 6, pct(0.95) - 35);

  const total = audio.length / SR;
  const minRun = Math.floor(MIN_PAUSE / step);
  const cuts = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    if (db[i] < thresh) { run++; continue; }
    if (run >= minRun) cuts.push((i - Math.floor(run / 2)) * step);
    run = 0;
  }
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < total), total];
  const pieces = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    let a = bounds[k];
    const b = bounds[k + 1];
    while (b - a > MAX_CHUNK) { pieces.push([a, a + MAX_CHUNK]); a += MAX_CHUNK; }
    if (b - a > 0.05) pieces.push([a, b]);
  }
  return pieces;
}

const slice = (audio, a, b) => audio.subarray(Math.floor(a * SR), Math.floor(b * SR));

async function detectLang({ processor, model }, piece, allowed) {
  const gc = model.generation_config;
  const { input_features } = await processor(piece);
  const out = await model({
    input_features,
    decoder_input_ids: new Tensor('int64', [BigInt(gc.decoder_start_token_id)], [1, 1]),
  });
  const logits = out.logits.data;
  let best = allowed[0], bestScore = -Infinity;
  for (const l of allowed) {
    const s = logits[gc.lang_to_id[`<|${l}|>`]];
    if (s > bestScore) { bestScore = s; best = l; }
  }
  return best;
}

async function transcribe({ processor, model }, piece, lang) {
  const { input_features } = await processor(piece);
  const ids = await model.generate({
    inputs: input_features, language: lang, task: 'transcribe', max_new_tokens: 440,
  });
  return processor.batch_decode(ids, { skip_special_tokens: true })[0].trim();
}

function fmt(t) {
  const s = Math.floor(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

async function run({ audio, model: key, langs: allowed, cpu }) {
  const m = await load(key, cpu);
  const total = audio.length / SR;

  post('status', { text: 'Diller tespit ediliyor...', progress: 0 });
  const pieces = splitUtterances(audio);
  const langs = [];
  for (let i = 0; i < pieces.length; i++) {
    const [a, b] = pieces[i];
    langs.push(b - a < MIN_LANG ? null : await detectLang(m, slice(audio, a, b), allowed));
    post('status', { text: `Diller tespit ediliyor ${i + 1}/${pieces.length}`, progress: (0.25 * (i + 1)) / pieces.length });
  }
  // kısa parçalar: önceki (yoksa sonraki) parçanın dilini al
  let last = langs.find((l) => l) ?? allowed[0];
  for (let i = 0; i < langs.length; i++) { langs[i] ??= last; last = langs[i]; }

  // aynı dildeki ardışık parçaları birleştir
  const chunks = [];
  pieces.forEach(([a, b], i) => {
    const c = chunks.at(-1);
    if (c && c[2] === langs[i] && b - c[0] <= MAX_CHUNK) c[1] = b;
    else chunks.push([a, b, langs[i]]);
  });

  for (let i = 0; i < chunks.length; i++) {
    const [a, b, lang] = chunks[i];
    post('status', {
      text: `Yazıya dökülüyor ${i + 1}/${chunks.length} — ${fmt(a)} / ${fmt(total)}`,
      progress: 0.25 + (0.75 * (i + 1)) / chunks.length,
    });
    const text = await transcribe(m, slice(audio, a, b), lang);
    if (text) post('line', { time: fmt(a), lang, text });
  }
  post('done');
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') { await load(data.model, data.cpu); post('loaded'); }
    if (data.type === 'run') await run(data);
  } catch (e) {
    post('error', { text: String(e?.message ?? e) });
  }
};
