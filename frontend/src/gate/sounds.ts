// Short tones made with the Web Audio API: no sound files to ship.
let context: AudioContext | null = null;

function tone(frequency: number, startAt: number, duration: number, type: OscillatorType) {
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(context.currentTime + startAt);
  oscillator.stop(context.currentTime + startAt + duration);
}

function ready(): boolean {
  if (typeof AudioContext === "undefined") return false;
  context ??= new AudioContext();
  void context.resume?.();
  return true;
}

/** A bright double beep. */
export function playApproved(): void {
  if (!ready()) return;
  tone(880, 0, 0.12, "sine");
  tone(1320, 0.15, 0.18, "sine");
}

/** A low buzz. */
export function playDenied(): void {
  if (!ready()) return;
  tone(160, 0, 0.45, "square");
}
