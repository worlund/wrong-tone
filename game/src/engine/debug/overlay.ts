// F3 overlay: frame time, simulation time, draw calls and backend. Kept from day one
// so performance regressions are visible the moment they happen.

export interface FrameStats {
  frameMs: number;
  simMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  backend: string;
  resolution: string;
  ticksThisFrame: number;
}

const WINDOW_MS = 500;

export class DebugOverlay {
  visible = false;
  private el: HTMLPreElement;
  private acc = { frames: 0, frameMs: 0, worst: 0, simMs: 0, renderMs: 0, elapsed: 0 };
  /** Exposed for automated checks (e.g. a performance smoke test). */
  latest = { fps: 0, avgFrameMs: 0, worstFrameMs: 0, avgSimMs: 0, avgRenderMs: 0 };

  constructor(root: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    root.append(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Called every frame; recomputes averages and touches the DOM twice per second. */
  update(s: FrameStats): void {
    const a = this.acc;
    a.frames++;
    a.frameMs += s.frameMs;
    a.worst = Math.max(a.worst, s.frameMs);
    a.simMs += s.simMs;
    a.renderMs += s.renderMs;
    a.elapsed += s.frameMs;
    if (a.elapsed < WINDOW_MS) return;

    this.latest = {
      fps: (1000 * a.frames) / a.elapsed,
      avgFrameMs: a.frameMs / a.frames,
      worstFrameMs: a.worst,
      avgSimMs: a.simMs / a.frames,
      avgRenderMs: a.renderMs / a.frames,
    };
    Object.assign(a, { frames: 0, frameMs: 0, worst: 0, simMs: 0, renderMs: 0, elapsed: 0 });
    if (!this.visible) return;
    const l = this.latest;
    this.el.textContent = [
      `${l.fps.toFixed(0)} fps   frame ${l.avgFrameMs.toFixed(1)} ms (worst ${l.worstFrameMs.toFixed(1)})`,
      `sim ${l.avgSimMs.toFixed(2)} ms   render cpu ${l.avgRenderMs.toFixed(2)} ms`,
      `draw calls ${s.drawCalls}   triangles ${s.triangles}`,
      `${s.backend}   ${s.resolution}   ticks/frame ${s.ticksThisFrame}`,
    ].join('\n');
  }
}
