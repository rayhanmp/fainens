/**
 * The recap's sound effects, haptics and an optional groove, all synthesised on the fly so there are no
 * audio files to ship. Off until the viewer turns them on; the choice is remembered in this browser only.
 */
export type Sound =
  | 'whoosh' | 'tick' | 'thunk' | 'chime' | 'buzz' | 'pop' | 'scratch' | 'fanfare'
  | 'bloom' | 'shutter' | 'swish' | 'flap' | 'glitch' | 'thud' | 'whirl' | 'zoom' | 'rewind'
  | 'shimmer' | 'warp' | 'pour' | 'patter' | 'chord' | 'coin' | 'oink' | 'ding' | 'needle'
  | 'riser' | 'drumroll' | 'cymbal' | 'horn' | 'jingle' | 'cash' | 'arcade' | 'gong';
export type SoundMode = 'off' | 'fx' | 'music';

const STORAGE_KEY = 'fainens.recap.sound';
let mode: SoundMode = readPreference();
let context: AudioContext | null = null;

function readPreference(): SoundMode {
  try {
    const value = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    return value === 'on' || value === 'fx' ? 'fx' : value === 'music' ? 'music' : 'off';
  } catch { return 'off'; }
}

export const soundMode = () => mode;
export const soundEnabled = () => mode !== 'off';
export function setSoundMode(value: SoundMode) {
  mode = value;
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode: keep it for this visit */ }
  if (value !== 'off') audio()?.resume().catch(() => undefined);
  if (value !== 'music') stopGroove();
}

function audio() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  context ??= new AudioContext();
  return context;
}

type ToneOptions = { type?: OscillatorType; from: number; to?: number; start?: number; length: number; gain?: number; vibrato?: number };
function tone(ctx: AudioContext, { type = 'sine', from, to = from, start = 0, length, gain = .12, vibrato = 0 }: ToneOptions, at = ctx.currentTime) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const t = at + start;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
  if (vibrato) {
    const lfo = ctx.createOscillator(); const depth = ctx.createGain();
    lfo.frequency.value = 7; depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency); lfo.start(t); lfo.stop(t + length + .05);
  }
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(.02, length / 4));
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + .02);
}

let noiseBuffer: AudioBuffer | null = null;
type NoiseOptions = { start?: number; length: number; from: number; to?: number; gain?: number; filter?: BiquadFilterType; q?: number };
function noise(ctx: AudioContext, { start = 0, length, from, to = from, gain = .08, filter = 'bandpass', q = 1.4 }: NoiseOptions, at = ctx.currentTime) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  const band = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  const t = at + start;
  source.buffer = noiseBuffer;
  band.type = filter; band.Q.value = q;
  band.frequency.setValueAtTime(from, t);
  band.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(.03, length * .3));
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  source.connect(band).connect(amp).connect(ctx.destination);
  source.start(t, Math.random(), length + .05);
}

const notes = (ctx: AudioContext, freqs: number[], step: number, options: Omit<ToneOptions, 'from' | 'start'>) =>
  freqs.forEach((f, i) => tone(ctx, { ...options, from: f, start: i * step }));

const library: Record<Sound, (ctx: AudioContext) => void> = {
  whoosh: ctx => noise(ctx, { length: .32, from: 400, to: 2600, gain: .05 }),
  tick: ctx => tone(ctx, { type: 'square', from: 1800, to: 1200, length: .025, gain: .03 }),
  thunk: ctx => { tone(ctx, { from: 160, to: 45, length: .22, gain: .3 }); noise(ctx, { length: .08, from: 900, to: 200, gain: .06 }); },
  pop: ctx => tone(ctx, { type: 'triangle', from: 520, to: 980, length: .08, gain: .08 }),
  chime: ctx => notes(ctx, [784, 988, 1175], .07, { type: 'triangle', length: .45, gain: .08 }),
  buzz: ctx => tone(ctx, { type: 'sawtooth', from: 150, to: 110, length: .28, gain: .06 }),
  scratch: ctx => noise(ctx, { length: .09, from: 2500, to: 3200, gain: .025 }),
  fanfare: ctx => { notes(ctx, [523, 659, 784], .09, { type: 'triangle', length: .2, gain: .09 }); tone(ctx, { type: 'triangle', from: 1047, start: .27, length: .7, gain: .09 }); },
  bloom: ctx => { tone(ctx, { from: 300, to: 900, length: .5, gain: .06 }); tone(ctx, { type: 'triangle', from: 450, to: 1350, length: .5, gain: .03 }); },
  shutter: ctx => { for (let i = 0; i < 7; i++) noise(ctx, { start: i * .035, length: .03, from: 3200, gain: .05 }); },
  swish: ctx => noise(ctx, { length: .45, from: 3200, to: 500, gain: .06 }),
  flap: ctx => { noise(ctx, { length: .06, from: 1500, gain: .07 }); noise(ctx, { start: .12, length: .06, from: 1100, gain: .06 }); },
  glitch: ctx => { for (let i = 0; i < 9; i++) tone(ctx, { type: 'square', from: 200 + Math.random() * 1800, start: i * .032, length: .025, gain: .035 }); },
  thud: ctx => { tone(ctx, { from: 95, to: 38, length: .32, gain: .32 }); noise(ctx, { length: .12, from: 300, to: 80, gain: .07, filter: 'lowpass' }); },
  whirl: ctx => { noise(ctx, { length: .25, from: 400, to: 2600, gain: .05 }); noise(ctx, { start: .25, length: .25, from: 2600, to: 400, gain: .05 }); },
  zoom: ctx => tone(ctx, { from: 200, to: 1600, length: .35, gain: .05 }),
  rewind: ctx => { tone(ctx, { type: 'sawtooth', from: 900, to: 120, length: .6, gain: .04, vibrato: 30 }); noise(ctx, { length: .6, from: 4000, to: 600, gain: .03 }); },
  shimmer: ctx => notes(ctx, [1319, 1568, 1976, 2637, 1976, 2637], .06, { type: 'triangle', length: .35, gain: .035 }),
  warp: ctx => { tone(ctx, { type: 'sawtooth', from: 80, to: 1200, length: .9, gain: .04 }); noise(ctx, { length: .9, from: 300, to: 5000, gain: .03 }); },
  pour: ctx => { for (let i = 0; i < 12; i++) tone(ctx, { from: 400 + Math.random() * 500, to: 900 + Math.random() * 400, start: i * .1 + Math.random() * .04, length: .07, gain: .04 }); },
  patter: ctx => { for (let i = 0; i < 34; i++) noise(ctx, { start: Math.random() * 1.4, length: .025, from: 2000 + Math.random() * 3000, gain: .03 }); },
  chord: ctx => [523, 659, 784, 988].forEach(f => tone(ctx, { type: 'triangle', from: f, length: 1.3, gain: .03 })),
  coin: ctx => { tone(ctx, { type: 'square', from: 988, length: .08, gain: .045 }); tone(ctx, { type: 'square', from: 1319, start: .08, length: .3, gain: .045 }); },
  oink: ctx => { tone(ctx, { type: 'sawtooth', from: 260, to: 180, length: .12, gain: .05, vibrato: 20 }); tone(ctx, { type: 'sawtooth', from: 300, to: 210, start: .14, length: .14, gain: .05, vibrato: 20 }); },
  ding: ctx => { tone(ctx, { from: 784, length: .7, gain: .09 }); tone(ctx, { from: 622, start: .35, length: .9, gain: .09 }); },
  needle: ctx => { for (let i = 0; i < 22; i++) noise(ctx, { start: Math.random() * 1, length: .012, from: 5000, gain: .05, filter: 'highpass' }); },
  riser: ctx => tone(ctx, { type: 'sawtooth', from: 180, to: 1200, length: 1.6, gain: .03 }),
  drumroll: ctx => { for (let i = 0; i < 26; i++) noise(ctx, { start: i * .045, length: .05, from: 900, gain: .02 + i * .002, q: .8 }); },
  cymbal: ctx => noise(ctx, { length: 1.3, from: 7000, to: 5000, gain: .05, filter: 'highpass' }),
  horn: ctx => { tone(ctx, { type: 'sawtooth', from: 440, to: 470, length: .55, gain: .04, vibrato: 14 }); tone(ctx, { type: 'sawtooth', from: 554, to: 590, length: .55, gain: .03, vibrato: 14 }); },
  jingle: ctx => notes(ctx, [523, 659, 784, 1047, 1319], .075, { type: 'triangle', length: .4, gain: .06 }),
  cash: ctx => { noise(ctx, { length: .12, from: 1200, gain: .06 }); tone(ctx, { type: 'triangle', from: 2093, start: .1, length: .5, gain: .06 }); tone(ctx, { type: 'triangle', from: 2637, start: .16, length: .6, gain: .05 }); },
  arcade: ctx => notes(ctx, [523, 784, 659, 1047, 784, 1319], .07, { type: 'square', length: .09, gain: .035 }),
  // A temple gong: a low fundamental with slightly inharmonic partials and a long tail.
  gong: ctx => [[98, .18], [151, .09], [233, .05], [347, .03]].forEach(([f, g]) => tone(ctx, { from: f, to: f * .985, length: 3.2, gain: g, vibrato: 1.5 })),
};

const buzzPatterns: Partial<Record<Sound, number | number[]>> = {
  thunk: 28, thud: 40, chime: [14, 40, 14], buzz: [40, 30, 40], pop: 10, fanfare: [20, 50, 20, 50, 60], coin: 12, oink: [15, 30, 15], cash: [20, 30, 40], cymbal: 50, horn: [30, 40, 30],
};

// Sounds queued for later, so closing the recap can call them off.
const pending = new Set<number>();

export function play(sound: Sound, delayMs = 0) {
  if (mode === 'off') return;
  const run = () => {
    const ctx = audio();
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      library[sound](ctx);
    }
    const pattern = buzzPatterns[sound];
    // Browsers refuse to vibrate before the first real tap, and say so in the console; don't ask early.
    const tapped = typeof navigator === 'undefined' || !('userActivation' in navigator) || navigator.userActivation.hasBeenActive;
    if (pattern && tapped && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  };
  if (delayMs <= 0) { run(); return; }
  const timer = window.setTimeout(() => { pending.delete(timer); run(); }, delayMs);
  pending.add(timer);
}

/** Everything stops when the recap closes: queued sounds, the groove, and the audio thread itself.
 * The context resumes on the next sound. */
export function silence() {
  pending.forEach(timer => window.clearTimeout(timer));
  pending.clear();
  stopGroove();
  if (context?.state === 'running') void context.suspend().catch(() => undefined);
}

/** A run of ticks easing out, for slot-machine digits landing. */
export function playTicks(count: number, durationMs: number, delayMs = 0) {
  if (mode === 'off') return;
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    play('tick', delayMs + durationMs * (1 - Math.pow(1 - progress, 2.4)));
  }
}

/* ---------- The groove: a small generative loop under the recap, in music mode only. ---------- */
let groove: { timer: number; next: number; step: number } | null = null;
const progressions = [[130.8, 110, 87.3, 98], [110, 87.3, 130.8, 98], [146.8, 116.5, 87.3, 130.8], [98, 130.8, 110, 87.3]];

/** Start the loop, with tempo and chords picked by the run, so each viewing has its own groove. */
export function startGroove(seed: number) {
  const ctx = audio();
  if (!ctx || mode !== 'music' || groove) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const bpm = 88 + (seed % 5) * 5;
  const sixteenth = 60 / bpm / 4;
  const chords = progressions[seed % progressions.length];
  groove = { timer: 0, next: ctx.currentTime + .1, step: 0 };
  const schedule = () => {
    if (!groove || mode !== 'music') return;
    while (groove.next < ctx.currentTime + .25) {
      const at = groove.next; const step = groove.step % 16; const bar = Math.floor(groove.step / 16) % chords.length;
      if (step === 0 || step === 8 || step === 10) tone(ctx, { from: 120, to: 42, length: .18, gain: .14 }, at);
      if (step === 4 || step === 12) noise(ctx, { length: .12, from: 1800, gain: .025 }, at);
      if (step % 2 === 0) noise(ctx, { length: .025, from: 8000, gain: .012, filter: 'highpass' }, at);
      if (step === 0 || step === 7) tone(ctx, { type: 'triangle', from: chords[bar], length: sixteenth * 6, gain: .045 }, at);
      if (step === 0) [2, 2.52, 3].forEach(ratio => tone(ctx, { type: 'sine', from: chords[bar] * ratio * 2, length: sixteenth * 15, gain: .008 }, at));
      groove.next += sixteenth;
      groove.step += 1;
    }
  };
  schedule();
  groove.timer = window.setInterval(schedule, 90);
}

export function stopGroove() {
  if (!groove) return;
  window.clearInterval(groove.timer);
  groove = null;
}
