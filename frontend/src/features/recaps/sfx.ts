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

/* ---------- The groove: a small generative loop under the recap, in music mode only. ----------
 * Each pack is built from layers (keys, bass, drums, hats, lead), and the story sets a scene as it goes:
 * an energy that decides how many layers play, a mood that turns the chords minor, and now and then a
 * whole new pack (a personality's theme). Changes land on the next half-bar after a short drum fill, so
 * the music moves with the slides without lurching. */
const progressions = [[130.8, 110, 87.3, 98], [110, 87.3, 130.8, 98], [146.8, 116.5, 87.3, 130.8], [98, 130.8, 110, 87.3]];

export type GroovePack = 'groove' | 'lofi' | 'chip' | 'orchestral' | 'koplo' | 'synthwave' | 'bossa' | 'trap' | 'gamelan' | 'jazz' | 'disco'
  | 'reggaeton' | 'amapiano' | 'citypop' | 'funk' | 'reggae' | 'dnb' | 'musicbox' | 'kroncong';
/** 0: keys alone (suspense, outros). 1: with bass and drums. 2: the full groove. 3: plus a lead on top. */
export type GrooveEnergy = 0 | 1 | 2 | 3;
export type GrooveScene = { energy: GrooveEnergy; mood: 'bright' | 'dark'; pack?: GroovePack };
/** One sixteenth of the music: `third` is the chord's third, major or minor by the scene's mood. */
type Beat = { ctx: AudioContext; at: number; step: number; bar: number; root: number; third: number; sixteenth: number; seed: number };
type Layer = (beat: Beat) => void;
type Pack = { bpm: (seed: number) => number; keys: Layer; bass?: Layer; drums?: Layer; hats?: Layer; lead?: Layer };

const kick = (ctx: AudioContext, at: number, gain = .14, from = 120) => tone(ctx, { from, to: 42, length: .18, gain }, at);
const snare = (ctx: AudioContext, at: number, gain = .025, length = .12) => noise(ctx, { length, from: 1800, gain }, at);
const hat = (ctx: AudioContext, at: number, gain = .012, length = .025) => noise(ctx, { length, from: 8000, gain, filter: 'highpass' }, at);
const chord = (beat: Beat, octave: number, ratios: number[], options: Omit<ToneOptions, 'from'>) =>
  ratios.forEach(ratio => tone(beat.ctx, { ...options, from: beat.root * octave * ratio }, beat.at));
const triad = (third: number) => [1, third, 1.5];
// Five-note scales over the root, for melodies that can't hit a wrong note.
const pentatonic = (third: number) => third > 1.2 ? [1, 1.122, 1.26, 1.5, 1.682] : [1, 1.189, 1.335, 1.5, 1.782];

/** Every sound is synthesised, so a pack costs a few lines, not a file. */
const packs: Record<GroovePack, Pack> = {
  // The house groove: kick, clap, hats, a triangle bass and a soft pad.
  groove: { bpm: seed => 88 + (seed % 5) * 5,
    keys: b => { if (b.step === 0) chord(b, 4, triad(b.third), { length: b.sixteenth * 15, gain: .008 }); },
    bass: b => { if (b.step === 0 || b.step === 7) tone(b.ctx, { type: 'triangle', from: b.root, length: b.sixteenth * 6, gain: .045 }, b.at); },
    drums: b => { if ([0, 8, 10].includes(b.step)) kick(b.ctx, b.at); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at); },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at); },
    lead: b => { if (b.step % 2 === 0) tone(b.ctx, { type: 'triangle', from: b.root * 8 * triad(b.third)[(b.step / 2) % 3], length: b.sixteenth * 1.6, gain: .01 }, b.at); } },
  // Lo-fi: slow, swung hats, a wobbly electric-piano chord and a little vinyl crackle.
  lofi: { bpm: seed => 72 + (seed % 4) * 3,
    keys: b => { if (b.step === 0 || b.step === 8) chord(b, 2, [1, b.third, 1.5, 1.89], { length: b.sixteenth * 7, gain: .012, vibrato: 3 }); if (b.step === 3) noise(b.ctx, { length: .01, from: 3000, gain: .01, filter: 'highpass' }, b.at); },
    bass: b => { if (b.step === 0) tone(b.ctx, { from: b.root, length: b.sixteenth * 8, gain: .04 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 10) kick(b.ctx, b.at, .12, 90); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .02, .16); },
    hats: b => { if (b.step % 2 === 0 || b.step === 7) hat(b.ctx, b.at + (b.step % 2 ? b.sixteenth * .28 : 0), .008, .03); },
    lead: b => { if (b.step === 6 || b.step === 14) tone(b.ctx, { type: 'triangle', from: b.root * 4 * pentatonic(b.third)[(b.bar + b.step) % 5], length: b.sixteenth * 3, gain: .014, vibrato: 4 }, b.at); } },
  // Chiptune: square-wave arpeggios over a pulse bass, a noise snare.
  chip: { bpm: seed => 124 + (seed % 4) * 4,
    keys: b => tone(b.ctx, { type: 'square', from: b.root * 4 * [1, b.third, 1.5, 2][b.step % 4], length: b.sixteenth * .9, gain: .014 }, b.at),
    bass: b => { if (b.step % 4 === 0) tone(b.ctx, { type: 'square', from: b.root, length: b.sixteenth * 1.8, gain: .03 }, b.at); if (b.step % 4 === 2) tone(b.ctx, { type: 'square', from: b.root * 1.5, length: b.sixteenth * .9, gain: .02 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { type: 'triangle', from: 160, to: 50, length: .12, gain: .12 }, b.at); if (b.step === 4 || b.step === 12) noise(b.ctx, { length: .07, from: 5000, gain: .03, filter: 'highpass' }, b.at); },
    hats: b => { if (b.step % 4 === 2) hat(b.ctx, b.at, .01); },
    lead: b => { if (b.step % 2 === 1) tone(b.ctx, { type: 'square', from: b.root * 8 * pentatonic(b.third)[(b.step + b.bar * 3) % 5], length: b.sixteenth * .8, gain: .008 }, b.at); } },
  // Orchestral: a held string chord each bar, timpani on the downbeat, pizzicato eighths.
  orchestral: { bpm: seed => 76 + (seed % 3) * 6,
    keys: b => { if (b.step === 0) chord(b, 2, [1, b.third, 1.5, 2], { type: 'sawtooth', length: b.sixteenth * 16, gain: .006, vibrato: 4 }); },
    bass: b => { if (b.step === 0) tone(b.ctx, { type: 'sawtooth', from: b.root / 2, length: b.sixteenth * 14, gain: .012 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { from: b.root, to: b.root * .82, length: .6, gain: .14 }, b.at); },
    hats: b => { if (b.step % 2 === 0) tone(b.ctx, { type: 'triangle', from: b.root * 4 * [1, 1.5, b.third, 2][(b.step / 2) % 4], length: .09, gain: .02 }, b.at); },
    lead: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { type: 'sawtooth', from: b.root * 4 * (b.step ? 1.5 : 2), length: b.sixteenth * 7, gain: .007, vibrato: 5 }, b.at); } },
  // Dangdut koplo: the kendang's "dhut" and "tak" on the classic koplo pattern, a bass and a suling line.
  koplo: { bpm: seed => 128 + (seed % 3) * 6,
    keys: b => { if (b.step % 4 === 2) tone(b.ctx, { type: 'sine', from: b.root * 4 * [1, 1.122, b.third, 1.335, 1.498][(b.step + b.seed) % 5], length: b.sixteenth * 2, gain: .018, vibrato: 6 }, b.at); },
    bass: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { type: 'triangle', from: b.root, length: b.sixteenth * 3, gain: .05 }, b.at); },
    drums: b => { if ([0, 6, 8, 14].includes(b.step)) tone(b.ctx, { from: 170, to: 85, length: .22, gain: .16 }, b.at); if ([3, 4, 11, 12].includes(b.step)) tone(b.ctx, { from: 520, to: 380, length: .06, gain: .06 }, b.at); if (b.step === 10) tone(b.ctx, { from: 320, to: 230, length: .12, gain: .07 }, b.at); },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at, .01, .02); },
    lead: b => { if (b.step === 13 || b.step === 15) tone(b.ctx, { from: 560, to: 400, length: .05, gain: .05 }, b.at); } },
  // Synthwave: a driving octave bass, a gated snare, a held pad and a sawtooth arpeggio.
  synthwave: { bpm: seed => 100 + (seed % 3) * 5,
    keys: b => { if (b.step === 0) chord(b, 2, triad(b.third), { type: 'sawtooth', length: b.sixteenth * 16, gain: .005, vibrato: 2 }); },
    bass: b => { if (b.step % 2 === 0) tone(b.ctx, { type: 'sawtooth', from: b.root / 2 * (b.step % 4 ? 2 : 1), length: b.sixteenth * 1.4, gain: .018 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 8) kick(b.ctx, b.at, .15); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .05, .22); },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at, .009); },
    lead: b => tone(b.ctx, { type: 'sawtooth', from: b.root * 4 * [1, b.third, 1.5, 2][b.step % 4], length: b.sixteenth * .8, gain: .006 }, b.at) },
  // Bossa nova: a clave on the rim, soft surdo, a shaker, nylon-string comping and a breathy flute.
  bossa: { bpm: seed => 84 + (seed % 3) * 4,
    keys: b => { if ([2, 5, 8, 11, 14].includes(b.step)) chord(b, 2, [b.third, 1.5, 1.89], { type: 'triangle', length: b.sixteenth * 1.5, gain: .01 }); },
    bass: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { from: b.root, length: b.sixteenth * 5, gain: .05 }, b.at); if (b.step === 6 || b.step === 14) tone(b.ctx, { from: b.root * 1.5, length: b.sixteenth * 2, gain: .04 }, b.at); },
    drums: b => { if ([0, 3, 6, 10, 13].includes(b.step)) tone(b.ctx, { type: 'square', from: 1250, length: .02, gain: .018 }, b.at); if (b.step === 0 || b.step === 8) kick(b.ctx, b.at, .07, 90); },
    hats: b => hat(b.ctx, b.at, b.step % 4 === 0 ? .009 : .005, .04),
    lead: b => { if (b.step === 0 || b.step === 10) tone(b.ctx, { from: b.root * 4 * pentatonic(b.third)[(b.bar * 2 + b.step) % 5], length: b.sixteenth * 5, gain: .016, vibrato: 5 }, b.at); } },
  // Trap: a long 808 under rolling hats, a half-time clap and a bell chord.
  trap: { bpm: seed => 70 + (seed % 3) * 3,
    keys: b => { if (b.step === 0) chord(b, 4, triad(b.third), { length: b.sixteenth * 8, gain: .009 }); },
    bass: b => { if (b.step === 0 || b.step === 7 || b.step === 10) tone(b.ctx, { from: b.root / 2 * 1.06, to: b.root / 2, length: b.sixteenth * 5, gain: .09 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 10) kick(b.ctx, b.at, .1, 90); if (b.step === 8) { snare(b.ctx, b.at, .05, .16); noise(b.ctx, { length: .1, from: 1100, gain: .03 }, b.at + .01); } },
    hats: b => { hat(b.ctx, b.at, .008); if (b.step >= 13) hat(b.ctx, b.at + b.sixteenth / 2, .007); },
    lead: b => { if (b.step % 4 === 2) tone(b.ctx, { type: 'triangle', from: b.root * 4 * pentatonic(1.189)[(b.step / 2 + b.bar) % 5], length: .12, gain: .014 }, b.at); } },
  // Gamelan: interlocking metallophones over a slow gong, a kendang and the kempyang's ticks.
  gamelan: { bpm: seed => 88 + (seed % 3) * 4,
    keys: b => { if (b.step % 2 === 0) { const f = b.root * 4 * [1, 1.14, 1.31, 1.51, 1.74][(b.step / 2 + b.bar) % 5]; tone(b.ctx, { from: f, length: .5, gain: .016 }, b.at); tone(b.ctx, { from: f * 2.76, length: .2, gain: .004 }, b.at); } },
    bass: b => { if (b.step % 4 === 0) tone(b.ctx, { from: b.root * 2 * [1, 1.31, 1.14, 1.51][b.step / 4], length: .9, gain: .03 }, b.at); if (b.step === 0 && b.bar % 2 === 0) tone(b.ctx, { from: 98, to: 96, length: 3, gain: .12, vibrato: 1.5 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 11) tone(b.ctx, { from: 210, to: 120, length: .14, gain: .1 }, b.at); if (b.step === 6) tone(b.ctx, { from: 480, to: 360, length: .05, gain: .04 }, b.at); },
    hats: b => { if (b.step % 2 === 1) tone(b.ctx, { from: 1900, length: .04, gain: .006 }, b.at); },
    lead: b => tone(b.ctx, { from: b.root * 8 * [1, 1.14, 1.31, 1.51, 1.74][(b.step * 2 + b.bar) % 5], length: .12, gain: .006 }, b.at) },
  // Jazz: a swung ride, brushes, a walking bass and rootless comping.
  jazz: { bpm: seed => 100 + (seed % 4) * 4,
    keys: b => { if (b.step === 6 || b.step === 14) chord(b, 2, [b.third, 1.5, 1.78], { type: 'triangle', length: b.sixteenth * 2, gain: .011 }); },
    bass: b => { if (b.step % 4 === 0) tone(b.ctx, { type: 'triangle', from: b.root * [1, b.third, 1.5, 1.68][b.step / 4], length: b.sixteenth * 3.5, gain: .05 }, b.at); },
    drums: b => { if (b.step === 4 || b.step === 12) noise(b.ctx, { length: .18, from: 2500, gain: .012 }, b.at); if (b.step === 0) kick(b.ctx, b.at, .05, 80); },
    hats: b => { if ([0, 4, 8, 12].includes(b.step) || b.step % 4 === 3) noise(b.ctx, { length: .16, from: 6500, gain: .008, filter: 'highpass' }, b.at + (b.step % 4 === 3 ? b.sixteenth * .3 : 0)); },
    lead: b => { if (b.step === 2 || b.step === 9) tone(b.ctx, { type: 'sawtooth', from: b.root * 4 * pentatonic(b.third)[(b.bar + b.step) % 5], length: b.sixteenth * 2.5, gain: .005, vibrato: 3 }, b.at); } },
  // Disco: four on the floor, open hats on the offbeat, an octave bass and string stabs.
  disco: { bpm: seed => 116 + (seed % 3) * 4,
    keys: b => { if (b.step === 0 || b.step === 7) chord(b, 2, triad(b.third), { type: 'sawtooth', length: b.sixteenth * 1.2, gain: .008 }); },
    bass: b => { if (b.step % 2 === 0) tone(b.ctx, { type: 'triangle', from: b.root * (b.step % 4 ? 2 : 1), length: b.sixteenth * 1.2, gain: .05 }, b.at); },
    drums: b => { if (b.step % 4 === 0) kick(b.ctx, b.at, .14); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .03); },
    hats: b => { if (b.step % 4 === 2) hat(b.ctx, b.at, .014, .12); else if (b.step % 2 === 1) hat(b.ctx, b.at, .006); },
    lead: b => { if (b.step >= 12) tone(b.ctx, { type: 'sawtooth', from: b.root * 4 * [1, b.third, 1.5, 2][b.step - 12], length: b.sixteenth * .9, gain: .007 }, b.at); } },
  // Reggaeton: the dembow (boom, ch-boom, chick) under plucked chord stabs and a synth hook.
  reggaeton: { bpm: seed => 92 + (seed % 3) * 3,
    keys: b => { if (b.step === 2 || b.step === 10) chord(b, 2, triad(b.third), { type: 'triangle', length: b.sixteenth * 1.2, gain: .012 }); },
    bass: b => { if ([0, 6, 8, 14].includes(b.step)) tone(b.ctx, { from: b.root, length: b.sixteenth * 2.5, gain: .06 }, b.at); },
    drums: b => { if (b.step % 4 === 0) kick(b.ctx, b.at, .13); if ([3, 6, 11, 14].includes(b.step)) snare(b.ctx, b.at, .03, .08); },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at, .009); },
    lead: b => { if (b.step === 4 || b.step === 12 || b.step === 13) tone(b.ctx, { type: 'square', from: b.root * 4 * pentatonic(b.third)[(b.bar + b.step) % 5], length: b.sixteenth * .9, gain: .008 }, b.at); } },
  // Amapiano: the log drum's bending boom, a shaker, jazzy pads and a marimba.
  amapiano: { bpm: seed => 112 + (seed % 3) * 2,
    keys: b => { if (b.step === 0) chord(b, 2, [1, b.third, 1.5, 1.89], { length: b.sixteenth * 15, gain: .007 }); },
    bass: b => { if ([0, 3, 7, 10].includes(b.step)) tone(b.ctx, { from: b.root * 2, to: b.root, length: b.sixteenth * 2.5, gain: .09 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 8) kick(b.ctx, b.at, .1); if (b.step === 8) noise(b.ctx, { length: .1, from: 1500, gain: .025 }, b.at); },
    hats: b => noise(b.ctx, { length: .03, from: 7000, gain: b.step % 4 === 2 ? .012 : .006, filter: 'highpass' }, b.at),
    lead: b => { if (b.step === 6 || b.step === 14 || b.step === 15) tone(b.ctx, { type: 'triangle', from: b.root * 4 * pentatonic(b.third)[(b.step + b.bar) % 5], length: .14, gain: .016 }, b.at); } },
  // City pop: Tokyo after dark. Rhodes chords with a major seventh, a slap-ish bass and a bright hook.
  citypop: { bpm: seed => 104 + (seed % 3) * 3,
    keys: b => { if (b.step === 0 || b.step === 7) chord(b, 2, [1, b.third, 1.5, 1.89], { length: b.sixteenth * 5, gain: .01, vibrato: 2 }); },
    bass: b => { if ([0, 3, 6, 10, 13].includes(b.step)) tone(b.ctx, { type: 'triangle', from: b.root * (b.step === 6 || b.step === 13 ? 2 : 1), length: b.sixteenth * 1.4, gain: .05 }, b.at); },
    drums: b => { if (b.step === 0 || b.step === 10) kick(b.ctx, b.at, .12); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .03); },
    hats: b => hat(b.ctx, b.at, b.step === 14 ? .014 : .007, b.step === 14 ? .12 : .025),
    lead: b => { if (b.step === 2 || b.step === 5 || b.step === 8) tone(b.ctx, { type: 'triangle', from: b.root * 8 * pentatonic(b.third)[(b.step + b.bar * 2) % 5], length: b.sixteenth * 2, gain: .011 }, b.at); } },
  // Funk: a syncopated bass, ghost notes on the snare, clavinet stabs and a horn hit.
  funk: { bpm: seed => 100 + (seed % 3) * 3,
    keys: b => { if ([2, 6, 10, 14].includes(b.step)) chord(b, 4, triad(b.third), { type: 'square', length: .05, gain: .006 }); },
    bass: b => { if ([0, 2, 3, 6, 8, 11, 14].includes(b.step)) tone(b.ctx, { type: 'triangle', from: b.root * [1, 2, 1.5, 1, 1, 2, 1.5][[0, 2, 3, 6, 8, 11, 14].indexOf(b.step)], length: b.sixteenth * .9, gain: .055 }, b.at); },
    drums: b => { if ([0, 3, 10].includes(b.step)) kick(b.ctx, b.at, .13); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .035); if (b.step === 7 || b.step === 9) snare(b.ctx, b.at, .008, .05); },
    hats: b => hat(b.ctx, b.at, b.step % 2 ? .006 : .01),
    lead: b => { if (b.step === 12 || b.step === 13) chord(b, 4, [1, b.third, 1.5], { type: 'sawtooth', length: b.sixteenth * .8, gain: .006 }); } },
  // Reggae: the one drop (kick and rim together on three), an offbeat skank, a deep bass and a melodica.
  reggae: { bpm: seed => 72 + (seed % 3) * 2,
    keys: b => { if (b.step === 4 || b.step === 12) chord(b, 2, triad(b.third), { type: 'triangle', length: .08, gain: .014 }); if (b.step % 4 === 2) chord(b, 2, triad(b.third), { length: .06, gain: .004 }); },
    bass: b => { if ([0, 5, 6, 10].includes(b.step)) tone(b.ctx, { from: b.root * [1, 1.5, 1, b.third][[0, 5, 6, 10].indexOf(b.step)], length: b.sixteenth * 2.2, gain: .07 }, b.at); },
    drums: b => { if (b.step === 8) { kick(b.ctx, b.at, .14); tone(b.ctx, { type: 'square', from: 900, length: .03, gain: .02 }, b.at); } },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at + (b.step % 4 ? b.sixteenth * .25 : 0), .008); },
    lead: b => { if (b.step === 0 || b.step === 11) tone(b.ctx, { type: 'sawtooth', from: b.root * 4 * pentatonic(b.third)[(b.bar + b.step) % 5], length: b.sixteenth * 3, gain: .006, vibrato: 4 }, b.at); } },
  // Drum and bass: a fast two-step break, a long reese bass, a pad and a high arpeggio.
  dnb: { bpm: seed => 168 + (seed % 3) * 3,
    keys: b => { if (b.step === 0 && b.bar % 2 === 0) chord(b, 4, triad(b.third), { length: b.sixteenth * 30, gain: .006 }); },
    bass: b => { if (b.step === 0 || b.step === 8) { tone(b.ctx, { type: 'sawtooth', from: b.root / 2, length: b.sixteenth * 7, gain: .016 }, b.at); tone(b.ctx, { type: 'sawtooth', from: b.root / 2 * 1.008, length: b.sixteenth * 7, gain: .016 }, b.at); } },
    drums: b => { if (b.step === 0 || b.step === 10) kick(b.ctx, b.at, .13); if (b.step === 4 || b.step === 12) snare(b.ctx, b.at, .04, .1); },
    hats: b => { if (b.step % 2 === 0) hat(b.ctx, b.at, .009); },
    lead: b => { if (b.step % 2 === 1) tone(b.ctx, { from: b.root * 8 * [1, b.third, 1.5, 2][(b.step - 1) / 2 % 4], length: b.sixteenth * .8, gain: .006 }, b.at); } },
  // Music box: a celesta lullaby turning over a soft bass, the mechanism ticking underneath.
  musicbox: { bpm: seed => 78 + (seed % 3) * 3,
    keys: b => { if (b.step % 2 === 0) { const f = b.root * 8 * [1, 1.5, b.third * 2, 1.5][(b.step / 2) % 4]; tone(b.ctx, { from: f, length: .7, gain: .014 }, b.at); tone(b.ctx, { from: f * 3, length: .25, gain: .003 }, b.at); } },
    bass: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { from: b.root * 2, length: b.sixteenth * 7, gain: .025 }, b.at); },
    drums: b => { if (b.step % 4 === 0) tone(b.ctx, { type: 'square', from: 2400, length: .012, gain: .006 }, b.at); },
    lead: b => { if (b.step === 3 || b.step === 11) tone(b.ctx, { from: b.root * 16 * pentatonic(b.third)[(b.bar + b.step) % 5], length: .5, gain: .007 }, b.at); } },
  // Kroncong: the cak and cuk ukuleles trading offbeats, a plucked cello walking, a flute over the top.
  kroncong: { bpm: seed => 96 + (seed % 3) * 4,
    keys: b => { if (b.step === 4 || b.step === 12) chord(b, 4, triad(b.third), { type: 'triangle', length: .07, gain: .009 }); },
    bass: b => { if (b.step === 0 || b.step === 8) tone(b.ctx, { type: 'triangle', from: b.root, length: b.sixteenth * 3, gain: .05 }, b.at); },
    drums: b => { if ([1, 3, 5, 9, 11, 13].includes(b.step)) tone(b.ctx, { from: b.root * [1.5, 2, b.third * 2, 1.5, 2, 1.5][[1, 3, 5, 9, 11, 13].indexOf(b.step)], length: .16, gain: .035 }, b.at); },
    hats: b => { if (b.step % 4 === 2) chord(b, 8, triad(b.third), { type: 'triangle', length: .04, gain: .005 }); },
    lead: b => { if (b.step === 0 || b.step === 6 || b.step === 10) tone(b.ctx, { from: b.root * 4 * pentatonic(b.third)[(b.bar * 2 + b.step) % 5], length: b.sixteenth * 3.5, gain: .016, vibrato: 5 }, b.at); } },
};

type Groove = { timer: number; next: number; step: number; seed: number; base: GroovePack; pack: GroovePack; sixteenth: number; scene: GrooveScene; target: GrooveScene | null };
let groove: Groove | null = null;
const sixteenthOf = (pack: GroovePack, seed: number) => 60 / packs[pack].bpm(seed) / 4;

/** Start the loop, with tempo and chords picked by the run, so each viewing has its own groove. */
export function startGroove(seed: number, pack: GroovePack = 'groove', scene: GrooveScene = { energy: 1, mood: 'bright' }) {
  const ctx = audio();
  if (!ctx || mode !== 'music' || groove) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const chords = progressions[seed % progressions.length];
  const current: Groove = { timer: 0, next: ctx.currentTime + .1, step: 0, seed, base: pack, pack: scene.pack ?? pack, sixteenth: sixteenthOf(scene.pack ?? pack, seed), scene: { ...scene, pack: scene.pack ?? pack }, target: null };
  groove = current;
  const schedule = () => {
    if (groove !== current || mode !== 'music') return;
    while (current.next < ctx.currentTime + .25) {
      const step = current.step % 16;
      // A requested scene lands on the next half-bar; the two beats before it carry a snare fill.
      if (current.target && step % 8 === 0) {
        const target = current.target;
        current.scene = target; current.target = null;
        if (target.pack && target.pack !== current.pack) { current.pack = target.pack; current.sixteenth = sixteenthOf(target.pack, seed); }
      }
      const { energy, mood } = current.scene;
      const bar = Math.floor(current.step / 16);
      const beat: Beat = { ctx, at: current.next, step, bar, root: chords[bar % chords.length], third: mood === 'dark' ? 1.189 : 1.26, sixteenth: current.sixteenth, seed };
      const style = packs[current.pack];
      style.keys(beat);
      if (energy >= 1) { style.bass?.(beat); style.drums?.(beat); }
      if (energy >= 2) style.hats?.(beat);
      if (energy >= 3) style.lead?.(beat);
      if (current.target && step % 8 >= 4) snare(ctx, current.next, .012 + (step % 8 - 4) * .008, .06);
      current.next += current.sixteenth;
      current.step += 1;
    }
  };
  schedule();
  current.timer = window.setInterval(schedule, 90);
}

/** Ask the groove to follow the story: it changes on the next half-bar, after a fill. */
export function setGrooveScene(scene: GrooveScene) {
  if (!groove) return;
  // A scene without a pack of its own returns to the run's groove (after a personality's theme, say).
  const pack = scene.pack ?? groove.base;
  const now = groove.target ?? groove.scene;
  if (now.energy === scene.energy && now.mood === scene.mood && (now.pack ?? groove.pack) === pack) return;
  groove.target = { ...scene, pack };
}

export function stopGroove() {
  if (!groove) return;
  window.clearInterval(groove.timer);
  groove = null;
}
