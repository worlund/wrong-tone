// Voice lines from behind the door. M2 placeholder: the browser's built-in Chinese
// text-to-speech. Recorded native voices replace this later. Subtitles always show.

import type { GameContext } from '../context';

export function startVoice(ctx: GameContext): () => void {
  const synth = window.speechSynthesis as SpeechSynthesis | undefined;
  const pickVoice = () => {
    const voices = synth?.getVoices() ?? [];
    return voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? null;
  };
  synth?.getVoices(); // Chrome loads voices lazily

  return ctx.engine.events.on('voice', (line) => {
    const voice = pickVoice();
    if (!synth || !voice) return; // subtitles only
    const u = new SpeechSynthesisUtterance(line.hanzi);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.8;
    u.pitch = 0.55; // whatever is behind the door is not quite human
    // The mic must not hear our own line as the player's answer.
    u.onstart = () => ctx.tone.muteFor(1.5 + line.hanzi.length * 0.3);
    u.onend = u.onerror = () => ctx.tone.muteFor(0.3);
    synth.speak(u);
  });
}
