// Klip kaydedilince çalan kısa "ding" (oyunun içindeyken "kaydedildi mi?" sorusunu
// çözer). Ses dosyası gerekmez: iki notalı yumuşak bir ton sentezlenir.

let context: AudioContext | null = null;

export function playChime(volume = 0.35): void {
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [880, 1318.5].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // Ses aygıtı yoksa sessizce geçilir.
  }
}
