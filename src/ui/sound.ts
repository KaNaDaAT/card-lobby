/**
 * Short sounds for what happens at the table, made with the Web Audio API, so there are no
 * sound files. Muting is kept per browser. Browsers only allow sound after someone clicked or
 * typed on the page, so audio starts on the first such gesture and stays quiet before that.
 */
import type { TableEvent } from './events';

const MUTE_KEY = 'cardlobby.muted';

let audio: AudioContext | null = null;
let muted: boolean | null = null;

export function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      muted = false;
    }
  }
  return muted;
}

export function setMuted(on: boolean): void {
  muted = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? '1' : '0');
  } catch {
    // Private windows may refuse. The choice still holds until the page reloads.
  }
  if (!on) unlockAudio();
}

/** Creates or resumes the audio context. Call it from a click or key press. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** Starts audio on the first gesture anywhere on the page. */
export function listenForAudioUnlock(): void {
  const once = () => {
    unlockAudio();
    removeEventListener('pointerdown', once);
    removeEventListener('keydown', once);
  };
  addEventListener('pointerdown', once);
  addEventListener('keydown', once);
}

interface Tone {
  freq: number;
  /** Start, in seconds after now. */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Glides to this frequency. */
  to?: number;
}

function tones(a: AudioContext, t0: number, list: Tone[]): void {
  for (const t of list) {
    const start = t0 + t.at;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = t.type ?? 'triangle';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(t.gain ?? 0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(gain).connect(a.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }
}

/** Short bursts of filtered noise: a card flick, or many for a riffle shuffle. */
function noise(a: AudioContext, t0: number, bursts: { at: number; dur: number; freq: number; gain: number }[]): void {
  const length = Math.ceil(a.sampleRate * 0.08);
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  for (const b of bursts) {
    const start = t0 + b.at;
    const src = a.createBufferSource();
    const filter = a.createBiquadFilter();
    const gain = a.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = b.freq;
    gain.gain.setValueAtTime(b.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + b.dur);
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(start);
    src.stop(start + b.dur + 0.02);
  }
}

type SoundName = 'turn' | 'move' | 'card' | 'nope' | 'shuffle' | 'out' | 'win' | 'lose' | 'gameWin';

const SOUNDS: Record<SoundName, (a: AudioContext, t0: number) => void> = {
  turn: (a, t) => tones(a, t, [{ freq: 659, at: 0, dur: 0.16 }, { freq: 988, at: 0.12, dur: 0.3 }]),
  move: (a, t) => tones(a, t, [{ freq: 784, at: 0, dur: 0.18, type: 'sine', gain: 0.1 }]),
  card: (a, t) => {
    noise(a, t, [{ at: 0, dur: 0.06, freq: 2400, gain: 0.35 }]);
    tones(a, t, [{ freq: 190, at: 0, dur: 0.07, type: 'sine', gain: 0.12 }]);
  },
  nope: (a, t) => tones(a, t, [{ freq: 260, at: 0, dur: 0.22, type: 'square', gain: 0.05, to: 150 }]),
  shuffle: (a, t) => noise(a, t, Array.from({ length: 10 }, (_, i) => ({ at: i * 0.035, dur: 0.03, freq: 1800 + (i % 3) * 500, gain: 0.25 }))),
  out: (a, t) => tones(a, t, [{ freq: 440, at: 0, dur: 0.45, to: 110, gain: 0.1 }]),
  win: (a, t) => tones(a, t, [523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.1, dur: 0.25 }))),
  lose: (a, t) => tones(a, t, [392, 330, 262].map((freq, i) => ({ freq, at: i * 0.14, dur: 0.3, gain: 0.1 }))),
  gameWin: (a, t) => tones(a, t, [523, 659, 784, 1047, 784, 1047].map((freq, i) => ({ freq, at: i * 0.11, dur: i === 5 ? 0.6 : 0.2 }))),
};

function soundFor(e: TableEvent): SoundName {
  switch (e.kind) {
    case 'yourTurn':
      return 'turn';
    case 'yourMove':
      return 'move';
    case 'played':
      return 'card';
    case 'reaction':
      return 'nope';
    case 'shuffle':
      return 'shuffle';
    case 'out':
      return 'out';
    case 'roundOver':
      return e.won ? 'win' : 'lose';
    case 'gameOver':
      return e.won ? 'gameWin' : 'lose';
  }
}

/** What happened first sounds first: the card, then whose turn it is, then the result. */
const ORDER: SoundName[] = ['card', 'nope', 'out', 'shuffle', 'move', 'turn', 'lose', 'win', 'gameWin'];

/** Plays the sounds for a batch of events, one after another, at most three. */
export function playEvents(events: TableEvent[]): void {
  if (isMuted() || !audio || audio.state !== 'running' || !events.length) return;
  const names = [...new Set(events.map(soundFor))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).slice(0, 3);
  const t0 = audio.currentTime + 0.02;
  names.forEach((name, i) => SOUNDS[name](audio!, t0 + i * 0.22));
}
