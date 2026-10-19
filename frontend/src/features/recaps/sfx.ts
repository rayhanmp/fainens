/**
 * The recap's sound effects and haptics, synthesised on the fly so there are no audio files to ship.
 * Off until the viewer turns them on; the choice is remembered in this browser only.
 */
export type Sound = 'whoosh' | 'tick' | 'thunk' | 'chime' | 'buzz' | 'pop' | 'scratch' | 'fanfare';

const STORAGE_KEY = 'fainens.recap.sound';
let enabled = readPreference();
let context: AudioContext | null = null;

function readPreference() {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'on'; } catch { return false; }
}

export const soundEnabled = () => enabled;
export function setSoundEnabled(value: boolean) {
  enabled = value;
  try { window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'); } catch { /* private mode: keep it for this visit */ }
  if (value) audio()?.resume().catch(() => undefined);
}

function audio() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  context ??= new AudioContext();
  return context;
}

function tone(ctx: AudioContext, { type = 'sine', from, to = from, start = 0, length, gain = .12 }: { type?: OscillatorType; from: number; to?: number; start?: number; length: number; gain?: number }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + .01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + .02);
}

function noise(ctx: AudioContext, { start = 0, length, from, to, gain = .08 }: { start?: number; length: number; from: number; to: number; gain?: number }) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  const t = ctx.currentTime + start;
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + length * .3);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start(t);
}

const buzzPatterns: Partial<Record<Sound, number | number[]>> = { thunk: 28, chime: [14, 40, 14], buzz: [40, 30, 40], pop: 10, fanfare: [20, 50, 20, 50, 60] };

export function play(sound: Sound, delayMs = 0) {
  if (!enabled) return;
  const run = () => {
    const ctx = audio();
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      switch (sound) {
        case 'whoosh': noise(ctx, { length: .32, from: 400, to: 2600, gain: .05 }); break;
        case 'tick': tone(ctx, { type: 'square', from: 1800, to: 1200, length: .025, gain: .03 }); break;
        case 'thunk': tone(ctx, { from: 160, to: 45, length: .22, gain: .3 }); noise(ctx, { length: .08, from: 900, to: 200, gain: .06 }); break;
        case 'pop': tone(ctx, { type: 'triangle', from: 520, to: 980, length: .08, gain: .08 }); break;
        case 'chime': [784, 988, 1175].forEach((f, i) => tone(ctx, { type: 'triangle', from: f, start: i * .07, length: .45, gain: .08 })); break;
        case 'buzz': tone(ctx, { type: 'sawtooth', from: 150, to: 110, length: .28, gain: .06 }); break;
        case 'scratch': noise(ctx, { length: .09, from: 2500, to: 3200, gain: .025 }); break;
        case 'fanfare': [523, 659, 784, 1047].forEach((f, i) => tone(ctx, { type: 'triangle', from: f, start: i * .09, length: i === 3 ? .7 : .2, gain: .09 })); break;
      }
    }
    const pattern = buzzPatterns[sound];
    if (pattern && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  };
  if (delayMs > 0) window.setTimeout(run, delayMs); else run();
}

/** A run of ticks easing out, for slot-machine digits landing. */
export function playTicks(count: number, durationMs: number, delayMs = 0) {
  if (!enabled) return;
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    play('tick', delayMs + durationMs * (1 - Math.pow(1 - progress, 2.4)));
  }
}
