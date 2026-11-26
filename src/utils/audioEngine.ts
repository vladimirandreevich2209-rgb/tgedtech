let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: {
    type?: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
  };
}

export function configureIosAudioSession(): void {
  try {
    if (typeof navigator !== 'undefined') {
      const nav = navigator as NavigatorWithAudioSession;
      if (nav.audioSession) {
        nav.audioSession.type = 'play-and-record';
      }
    }
  } catch {
    // Ignore on unsupported browsers or restricted contexts
  }
}

export async function ensureAudioContextRunning(): Promise<AudioContext> {
  configureIosAudioSession();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
}

function createBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number
): AudioBuffer {
  const safeLength = Math.max(1, length);
  try {
    return new AudioBuffer({
      numberOfChannels,
      length: safeLength,
      sampleRate,
    });
  } catch {
    return getAudioContext().createBuffer(numberOfChannels, safeLength, sampleRate);
  }
}

/**
 * Checks whether an AudioBuffer contains audible speech above the given amplitude threshold.
 */
export function hasAudibleSpeech(buffer: AudioBuffer, threshold = 0.025): boolean {
  let activeSamples = 0;
  let peak = 0;
  const minActiveSamples = Math.floor(buffer.sampleRate * 0.04);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
      if (abs >= threshold) activeSamples++;
    }
  }

  return peak >= threshold && activeSamples >= minActiveSamples;
}

/**
 * Pure silence trimming function: scans Float32Array channels from start and end,
 * locates speech boundaries above `threshold`, preserves 60ms padding on both sides,
 * and returns a trimmed AudioBuffer.
 */
export function trimSilence(buffer: AudioBuffer, threshold = 0.025): AudioBuffer {
  const { numberOfChannels, length, sampleRate } = buffer;
  const paddingSamples = Math.round(sampleRate * 0.06);

  let firstActive = -1;
  let lastActive = -1;

  for (let i = 0; i < length; i++) {
    let maxAtSample = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const val = Math.abs(buffer.getChannelData(ch)[i]);
      if (val > maxAtSample) maxAtSample = val;
    }
    if (maxAtSample >= threshold) {
      firstActive = i;
      break;
    }
  }

  if (firstActive === -1) {
    return createBuffer(numberOfChannels, 1, sampleRate);
  }

  for (let i = length - 1; i >= firstActive; i--) {
    let maxAtSample = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const val = Math.abs(buffer.getChannelData(ch)[i]);
      if (val > maxAtSample) maxAtSample = val;
    }
    if (maxAtSample >= threshold) {
      lastActive = i;
      break;
    }
  }

  const startSample = Math.max(0, firstActive - paddingSamples);
  const endSample = Math.min(length, lastActive + paddingSamples + 1);
  const trimmedLength = Math.max(1, endSample - startSample);

  const trimmed = createBuffer(numberOfChannels, trimmedLength, sampleRate);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = trimmed.getChannelData(ch);
    dst.set(src.subarray(startSample, startSample + trimmedLength));
  }

  return trimmed;
}

/**
 * Decodes an audio Blob or File into an AudioBuffer using Web Audio API.
 */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer.slice(0));
}

export const SYNTHETIC_REFERENCE_PEAKS_MS = [48, 83, 118] as const;

/**
 * Generates a 0.7s synthetic alveolar trill reference AudioBuffer ("ТРА"):
 * voiced vowel harmonics modulated by 3 sharp ~35ms alveolar closure pulses at the start,
 * creating 3 distinct energy peaks and troughs visible on the oscillogram.
 */
export function generateSyntheticReferenceBuffer(sampleRate = 44100): AudioBuffer {
  const durationSec = 0.7;
  const totalSamples = Math.round(sampleRate * durationSec);
  const buffer = createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Voiced fundamental & formant-like harmonics for open [A] after alveolar trill
  const f0 = 132;
  const formants = [
    { freq: f0, amp: 0.42 },
    { freq: f0 * 2, amp: 0.28 },
    { freq: f0 * 3, amp: 0.16 },
    { freq: 740, amp: 0.24 },
    { freq: 1180, amp: 0.14 },
    { freq: 2450, amp: 0.06 },
  ];

  // 3 alveolar tap cycles spaced ~35ms apart: peaks at ~48ms, ~83ms, ~118ms
  const peakCentersSec = [0.048, 0.083, 0.118];
  const troughCentersSec = [0.030, 0.0655, 0.1005, 0.1355];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Harmonic voiced carrier + subtle aspiration noise during trill onset
    let carrier = 0;
    for (let k = 0; k < formants.length; k++) {
      carrier += Math.sin(2 * Math.PI * formants[k].freq * t) * formants[k].amp;
    }

    // Subtle consonant air burst on the first 150ms
    const onsetNoise =
      t < 0.16 ? (Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 0.18 : 0;

    // Base global envelope: crisp attack, steady vowel sustain, smooth release
    let globalEnv = 1;
    if (t < 0.015) {
      globalEnv = t / 0.015;
    } else if (t > 0.52) {
      globalEnv = Math.max(0, 1 - (t - 0.52) / 0.18);
      globalEnv = globalEnv * globalEnv;
    }

    // Amplitude modulation for the first 155ms (3 sharp peaks & deep closures)
    let trillMod = 0.72;
    if (t < 0.165) {
      let pulseBoost = 0;
      for (let p = 0; p < peakCentersSec.length; p++) {
        const dist = (t - peakCentersSec[p]) / 0.0085;
        pulseBoost += Math.exp(-0.5 * dist * dist);
      }

      let closureDip = 0;
      for (let tr = 0; tr < troughCentersSec.length; tr++) {
        const dist = (t - troughCentersSec[tr]) / 0.0065;
        closureDip += Math.exp(-0.5 * dist * dist);
      }

      // Base low level during trill region + strong peak bursts - deep closure drops
      trillMod = Math.max(0.04, Math.min(1.0, 0.18 + 0.82 * pulseBoost - 0.35 * closureDip));
    } else if (t < 0.21) {
      // Smooth transition from 3rd closure into vowel sustain
      const blend = (t - 0.165) / 0.045;
      trillMod = 0.16 + blend * (0.72 - 0.16);
    }

    const sample = (carrier + onsetNoise * trillMod) * globalEnv * trillMod;
    data[i] = Math.max(-0.95, Math.min(0.95, sample * 0.82));
  }

  return buffer;
}

/**
 * Extracts peak-normalized amplitude buckets (0..1) for Canvas oscillogram rendering.
 */
export function extractNormalizedWaveform(
  buffer: AudioBuffer,
  bucketCount: number
): Float32Array {
  const buckets = new Float32Array(bucketCount);
  const channel = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / bucketCount));

  let globalPeak = 0;
  for (let b = 0; b < bucketCount; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(channel.length, start + samplesPerBucket);
    let maxVal = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(channel[i]);
      if (v > maxVal) maxVal = v;
    }
    buckets[b] = maxVal;
    if (maxVal > globalPeak) globalPeak = maxVal;
  }

  if (globalPeak > 0.0001) {
    for (let b = 0; b < bucketCount; b++) {
      buckets[b] = buckets[b] / globalPeak;
    }
  }

  return buckets;
}

/**
 * Finds up to 3 prominent onset peak timestamps (ms) in the first 300ms of an AudioBuffer
 * for haptic pulse cues when a user uploads a custom reference audio file.
 */
export function detectReferencePeakTimesMs(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  const windowSamples = Math.round(buffer.sampleRate * 0.01); // 10ms bins
  const maxScanSamples = Math.min(channel.length, Math.round(buffer.sampleRate * 0.35));
  const energies: number[] = [];

  for (let start = 0; start < maxScanSamples; start += windowSamples) {
    let peak = 0;
    const end = Math.min(maxScanSamples, start + windowSamples);
    for (let i = start; i < end; i++) {
      const a = Math.abs(channel[i]);
      if (a > peak) peak = a;
    }
    energies.push(peak);
  }

  const candidates: Array<{ idx: number; val: number }> = [];
  for (let i = 1; i < energies.length - 1; i++) {
    if (energies[i] > energies[i - 1] && energies[i] >= energies[i + 1] && energies[i] > 0.1) {
      candidates.push({ idx: i, val: energies[i] });
    }
  }

  if (candidates.length === 0) {
    return [...SYNTHETIC_REFERENCE_PEAKS_MS];
  }

  // Pick top 3 peaks separated by at least 20ms, sorted chronologically
  const picked: number[] = [];
  candidates
    .sort((a, b) => b.val - a.val)
    .forEach((c) => {
      const ms = c.idx * 10 + 5;
      if (picked.length < 3 && picked.every((p) => Math.abs(p - ms) >= 20)) {
        picked.push(ms);
      }
    });

  return picked.length > 0 ? picked.sort((a, b) => a - b) : [...SYNTHETIC_REFERENCE_PEAKS_MS];
}

/**
 * Generates a 0.6s clean alveolar trill contrast pattern for Step 5:
 * warm formant foundation + 3 crisp interruptions (~26 Hz modulation frequency),
 * without high-frequency hiss.
 */
export function generateCleanAlveolarSampleBuffer(
  sampleRate = 44100,
  f0Offset = 0
): AudioBuffer {
  const durationSec = 0.6;
  const totalSamples = Math.round(sampleRate * durationSec);
  const buffer = createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const f0 = 136 + f0Offset;
  const harmonics = [
    { freq: f0, amp: 0.48 },
    { freq: f0 * 2, amp: 0.30 },
    { freq: f0 * 3, amp: 0.16 },
    { freq: 680, amp: 0.22 },
    { freq: 1080, amp: 0.10 },
  ];

  // ~26 Hz modulation => period ~38.46 ms, 3 crisp stream interruptions inside first 150ms
  const modFreq = 26;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    let tone = 0;
    for (let h = 0; h < harmonics.length; h++) {
      tone += Math.sin(2 * Math.PI * harmonics[h].freq * t) * harmonics[h].amp;
    }

    let env = 1;
    if (t < 0.014) {
      env = t / 0.014;
    } else if (t > 0.44) {
      const rel = Math.max(0, 1 - (t - 0.44) / 0.16);
      env = rel * rel;
    }

    // 3 crisp interruptions at ~26 Hz in the trill window (0.02s .. 0.145s)
    let trillGate = 0.85;
    if (t >= 0.018 && t <= 0.135) {
      const phase = Math.sin(2 * Math.PI * modFreq * (t - 0.018));
      // Sharp rectangular-ish pulse interruption
      trillGate = phase > -0.15 ? 0.95 : 0.06;
    } else if (t > 0.135 && t < 0.175) {
      const blend = (t - 0.135) / 0.04;
      trillGate = 0.25 + blend * 0.6;
    }

    data[i] = Math.max(-0.92, Math.min(0.92, tone * env * trillGate * 0.78));
  }

  return buffer;
}

/**
 * Generates a 0.6s guttural/fricative breakdown pattern for Step 5:
 * muffled low tone + bandpass-filtered white noise (1200-2800 Hz) without crisp closures.
 */
export function generateThroatFricativeSampleBuffer(
  sampleRate = 44100,
  seedOffset = 1
): AudioBuffer {
  const durationSec = 0.6;
  const totalSamples = Math.round(sampleRate * durationSec);
  const buffer = createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // 2nd-order RBJ Bandpass filter centered at 1850 Hz, Q = 1.15 (~1200-2800 Hz passband)
  const centerFreq = 1850;
  const q = 1.15;
  const omega = (2 * Math.PI * centerFreq) / sampleRate;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const alpha = sinW / (2 * q);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  // Deterministic LCG PRNG for reproducible sandbox white noise
  let seed = (1337 + seedOffset * 7919) >>> 0;
  const nextWhite = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Muffled low uvular fundamental (~94 Hz) + sluggish soft wobble
    const wobble = 0.78 + 0.22 * Math.sin(2 * Math.PI * 14 * t);
    const lowTone =
      (Math.sin(2 * Math.PI * 94 * t) * 0.42 + Math.sin(2 * Math.PI * 188 * t) * 0.14) * wobble;

    // Bandpass white noise (1200-2800 Hz) simulating pharyngeal/uvular friction
    const x0 = nextWhite();
    const filteredNoise = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = filteredNoise;

    let env = 1;
    if (t < 0.025) {
      env = t / 0.025;
    } else if (t > 0.43) {
      const rel = Math.max(0, 1 - (t - 0.43) / 0.17);
      env = rel * rel;
    }

    // Stronger noise friction during the initial 260ms consonant zone
    const noiseWeight = t < 0.26 ? 0.62 : 0.22;
    const sample = (lowTone + filteredNoise * noiseWeight) * env;
    data[i] = Math.max(-0.92, Math.min(0.92, sample * 0.78));
  }

  return buffer;
}

/**
 * Converts an AudioBuffer into a standard 16-bit signed PCM .wav Blob with a 44-byte RIFF header.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = length * blockAlign;
  const totalByteLength = 44 + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalByteLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(int16), true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Generates a realistic 0.8s simulated guttural/fricative user recording ("Точка А"):
 * bandpass-filtered noise (1200-2800 Hz) + muffled low vowel tone without crisp alveolar closures,
 * allowing full end-to-end testing of Step 4 A/B-mirror and Step 6 WAV export without a mic.
 */
export function generateSimulatedThroatRecordingBuffer(sampleRate = 44100): AudioBuffer {
  const durationSec = 0.8;
  const totalSamples = Math.round(sampleRate * durationSec);
  const buffer = createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // 2nd-order RBJ Bandpass filter centered at 1850 Hz, Q = 1.15 (~1200-2800 Hz)
  const centerFreq = 1850;
  const q = 1.15;
  const omega = (2 * Math.PI * centerFreq) / sampleRate;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const alpha = sinW / (2 * q);

  const a0 = 1 + alpha;
  const nb0 = alpha / a0;
  const nb2 = -alpha / a0;
  const na1 = (-2 * cosW) / a0;
  const na2 = (1 - alpha) / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  let seed = 424242 >>> 0;
  const nextWhite = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Sluggish uvular flutter (~15 Hz) on a low muffled fundamental (~102 Hz)
    const flutter = 0.72 + 0.28 * Math.sin(2 * Math.PI * 15 * t);
    const vowelTone =
      (Math.sin(2 * Math.PI * 102 * t) * 0.44 +
        Math.sin(2 * Math.PI * 204 * t) * 0.18 +
        Math.sin(2 * Math.PI * 640 * t) * 0.12) *
      flutter;

    const x0 = nextWhite();
    const bandpassNoise = nb0 * x0 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = bandpassNoise;

    let env = 1;
    if (t < 0.03) {
      env = t / 0.03;
    } else if (t > 0.6) {
      const rel = Math.max(0, 1 - (t - 0.6) / 0.2);
      env = rel * rel;
    }

    // Two syllable-like swells simulating "ТРАК... РАК" uvular friction
    const frictionBurst =
      t < 0.32 ? 0.68 : t >= 0.42 && t < 0.68 ? 0.58 : 0.16;

    const sample = (vowelTone + bandpassNoise * frictionBurst) * env;
    data[i] = Math.max(-0.92, Math.min(0.92, sample * 0.78));
  }

  return buffer;
}

/**
 * Plays a crisp clinical metronome tick via Web Audio API without external audio files.
 */
export function playMetronomeClick(accent = false): void {
  try {
    configureIosAudioSession();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 1320 : 960, now);
    osc.frequency.exponentialRampToValueAtTime(accent ? 620 : 480, now + 0.025);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(accent ? 0.24 : 0.16, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  } catch {
    // Ignore if audio context blocked before user gesture
  }
}

/**
 * Plays a gentle two-tone clinical chime at the completion of a Stage 1 training step.
 */
export function playStepCompleteChime(): void {
  try {
    configureIosAudioSession();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const notes = [
      { freq: 587.33, start: 0, dur: 0.18 },
      { freq: 880.0, start: 0.14, dur: 0.28 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch {
    // Ignore audio context errors
  }
}

export interface AttemptDspResult {
  badge: 'flap' | 'noise' | 'neutral';
  label: string;
  meanZcr: number;
  maxNoiseStreakMs: number;
  detectedClosureMs: number | null;
}

/**
 * Client-side DSP analyzer for Stage 1 attempts:
 * Computes 10ms RMS energy envelope and Zero-Crossing Rate (ZCR).
 * - Detects short sharp amplitude dips (15–45 ms, i.e., 2–4 frames) inside voiced regions with moderate ZCR => Flap [ɾ].
 * - Detects sustained high-frequency noise (high ZCR > 120 ms, i.e., >= 12 frames) without clear closures => Fricative noise.
 */
export function analyzeAttempt(buffer: AudioBuffer): AttemptDspResult {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const winSize = Math.max(1, Math.round(sampleRate * 0.01)); // 10ms windows
  const numFrames = Math.floor(channel.length / winSize);

  if (numFrames < 4) {
    return {
      badge: 'neutral',
      label: 'Короткий сигнал — прослушайте на 0.5x',
      meanZcr: 0,
      maxNoiseStreakMs: 0,
      detectedClosureMs: null,
    };
  }

  const rmsArr = new Float32Array(numFrames);
  const zcrArr = new Float32Array(numFrames);
  let maxRms = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * winSize;
    const end = start + winSize;
    let sumSq = 0;
    let crossings = 0;
    let prev = channel[start];

    for (let i = start; i < end; i++) {
      const s = channel[i];
      sumSq += s * s;
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
        crossings++;
      }
      prev = s;
    }

    const rms = Math.sqrt(sumSq / winSize);
    rmsArr[f] = rms;
    zcrArr[f] = crossings / winSize;
    if (rms > maxRms) maxRms = rms;
  }

  const activeThreshold = Math.max(0.012, maxRms * 0.16);
  let activeFrames = 0;
  let zcrSum = 0;

  // Measure longest continuous high-ZCR noisy streak (> 120ms => > 12 frames)
  let currentNoiseStreak = 0;
  let maxNoiseFrames = 0;
  const highZcrThreshold = 0.135;

  for (let f = 0; f < numFrames; f++) {
    const active = rmsArr[f] >= activeThreshold;
    if (active) {
      activeFrames++;
      zcrSum += zcrArr[f];
    }

    if (active && zcrArr[f] >= highZcrThreshold) {
      currentNoiseStreak++;
      if (currentNoiseStreak > maxNoiseFrames) {
        maxNoiseFrames = currentNoiseStreak;
      }
    } else {
      currentNoiseStreak = 0;
    }
  }

  const meanZcr = activeFrames > 0 ? zcrSum / activeFrames : 0;
  const maxNoiseStreakMs = maxNoiseFrames * 10;

  // Detect short sharp amplitude dip (15–45 ms => 2 to 5 frames of 10ms) inside voiced region
  let detectedClosureFrames: number | null = null;
  const voicedFloor = Math.max(0.02, maxRms * 0.28);

  for (let startF = 1; startF < numFrames - 3; startF++) {
    // Must have solid voiced energy immediately before dip
    if (rmsArr[startF - 1] < voicedFloor) continue;

    // Look for dip window of length 2..4 frames (approx 15–45ms)
    for (let dipLen = 2; dipLen <= 4; dipLen++) {
      const endF = startF + dipLen;
      if (endF >= numFrames) break;

      // Must recover to voiced energy right after dip
      if (rmsArr[endF] < voicedFloor) continue;

      const boundaryMin = Math.min(rmsArr[startF - 1], rmsArr[endF]);
      let dipMax = 0;
      let dipZcrSum = 0;
      for (let k = startF; k < endF; k++) {
        if (rmsArr[k] > dipMax) dipMax = rmsArr[k];
        dipZcrSum += zcrArr[k];
      }
      const dipMeanZcr = dipZcrSum / dipLen;

      // Sharp drop inside voiced vowel (dip is <= 46% of surrounding voiced RMS) at moderate ZCR
      if (dipMax <= boundaryMin * 0.46 && dipMeanZcr < 0.18) {
        detectedClosureFrames = dipLen;
        break;
      }
    }
    if (detectedClosureFrames !== null) break;
  }

  const detectedClosureMs =
    detectedClosureFrames !== null ? detectedClosureFrames * 10 : null;

  if (detectedClosureMs !== null && meanZcr < 0.18) {
    return {
      badge: 'flap',
      label: 'Видна четкая смычка (Flap)',
      meanZcr,
      maxNoiseStreakMs,
      detectedClosureMs,
    };
  }

  if (maxNoiseStreakMs > 120 && detectedClosureMs === null) {
    return {
      badge: 'noise',
      label: 'Много щелевого шума — проверьте зажим под подбородком',
      meanZcr,
      maxNoiseStreakMs,
      detectedClosureMs: null,
    };
  }

  return {
    badge: 'neutral',
    label: 'Смычка не выражена — проверьте на 0.5x',
    meanZcr,
    maxNoiseStreakMs,
    detectedClosureMs,
  };
}




