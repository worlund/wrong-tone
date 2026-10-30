// In-game HUD as DOM: crosshair, interaction prompt, objective, subtitles, mic meter, fades.
// Updated every frame, but only touches the DOM when a value changes.

import type { FrameSystem } from '../../engine/core/system';
import { Interactable, Player } from '../components';
import type { GameContext } from '../context';
import { ANSWER } from '../lines';
import { Run, type Run as RunState } from '../run';
import { noiseThresholdDb } from '../systems/goldenPath';

const SUBTITLE_SECONDS = 4.5;

function objective(run: RunState, carrying: boolean, mic: boolean): string {
  switch (run.phase) {
    case 'explore': return carrying ? 'Deliver the package. Find the way out.' : 'Pick up the package.';
    case 'asked': return mic ? `Answer: say ${ANSWER.hanzi} (${ANSWER.pinyin})` : `Answer with the tone of ${ANSWER.hanzi} (${ANSWER.pinyin}): press 1–4`;
    case 'encounter': return mic ? 'Don’t make a sound.' : 'Don’t move.';
    case 'deliver': return 'Hand over the package.';
    default: return '';
  }
}

export function hudSystem(ctx: GameContext): FrameSystem {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="crosshair"></div>
    <div class="prompt"></div>
    <div class="objective"></div>
    <div class="subtitle"><div class="hanzi"></div><div class="pinyin"></div><div class="meaning"></div></div>
    <div class="mic" hidden><i class="level"></i><b class="threshold"></b></div>
    <div class="hint"></div>
    <div class="fade"></div>
    <div class="caught" hidden><div class="hanzi">它听见你了。</div><div class="pinyin">tā tīngjiàn nǐ le.</div><div class="meaning">It heard you.</div></div>`;
  document.querySelector('#ui')!.append(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const els = {
    prompt: $('.prompt'), objective: $('.objective'), hint: $('.hint'),
    subtitle: $('.subtitle'), subHanzi: $('.subtitle .hanzi'), subPinyin: $('.subtitle .pinyin'), subMeaning: $('.subtitle .meaning'),
    mic: $('.mic'), level: $('.mic .level'), threshold: $('.mic .threshold'),
    fade: $('.fade'), caught: $('.caught'),
  };
  const last = new Map<HTMLElement, string>();
  const text = (el: HTMLElement, value: string) => {
    if (last.get(el) !== value) {
      el.textContent = value;
      last.set(el, value);
    }
  };

  let subtitleLeft = 0;
  const offs = [
    ctx.engine.events.on('voice', (line) => {
      text(els.subHanzi, line.hanzi);
      text(els.subPinyin, line.pinyin);
      text(els.subMeaning, line.meaning);
      subtitleLeft = SUBTITLE_SECONDS;
    }),
    ctx.engine.events.on('ghostWall', () => {
      // Hard cut to black, then fade back in at the start.
      els.fade.style.transition = 'none';
      els.fade.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        els.fade.style.transition = 'opacity 0.9s ease-in';
        els.fade.style.opacity = '0';
      }));
    }),
  ];

  return {
    name: 'hud',
    frameUpdate(world, _alpha, dt) {
      const run = world.require(ctx.run, Run);
      const p = world.require(ctx.player, Player);
      const mic = ctx.tone.mode === 'mic';

      const focus = run.focus !== null ? world.require(run.focus, Interactable).prompt : '';
      text(els.prompt, focus ? `[E] ${focus}` : '');
      text(els.objective, objective(run, p.carrying !== null, mic));
      text(els.hint, run.phase === 'encounter' && !p.flashlight ? '[F] Flashlight' : '');

      subtitleLeft = Math.max(0, subtitleLeft - dt);
      els.subtitle.style.opacity = subtitleLeft > 0.5 ? '1' : String(subtitleLeft / 0.5);

      const showMic = mic && (run.phase === 'asked' || run.phase === 'encounter');
      els.mic.hidden = !showMic;
      if (showMic) {
        const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 70) / 60) * 100)).toFixed(1)}%`;
        els.level.style.width = pct(ctx.tone.levelDb);
        els.threshold.hidden = run.phase !== 'encounter';
        els.threshold.style.left = pct(noiseThresholdDb(run.quietBaselineDb));
        els.mic.classList.toggle('loud', run.loudFor > 0);
      }

      els.caught.hidden = run.phase !== 'caught';
    },
    dispose() {
      offs.forEach((off) => off());
      root.remove();
    },
  };
}
