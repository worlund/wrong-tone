// The Wrong Tone look as one TSL RenderPipeline (three r183+ name for PostProcessing):
// scene pass → chromatic aberration → tone mapping → depth Sobel outlines →
// posterise (32 bands, 50% mix) → vignette + grain.
// Materials marked with markAsSign() write signMask = 1 and skip the stylising,
// so Chinese text stays legible.

import { RenderPipeline, type Material, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  pass, mrt, output, float, vec2, vec3, vec4, uv, uniform, mix, floor, smoothstep, length,
  max, rand, time, screenSize, perspectiveDepthToViewZ, cameraNear, cameraFar, renderOutput,
} from 'three/tsl';

export interface PostSettings {
  outlineStrength: number;
  /** Depth gradient, relative to distance, that counts as an edge. */
  outlineThreshold: number;
  posterizeBands: number;
  posterizeMix: number;
  grain: number;
  vignette: number;
  chromaticAberration: number;
}

export const DEFAULT_POST: PostSettings = {
  outlineStrength: 0.75,
  outlineThreshold: 0.08,
  posterizeBands: 32,
  posterizeMix: 0.5,
  grain: 0.05,
  vignette: 0.45,
  chromaticAberration: 0.004,
};

/** Excludes a material from outlines, banding and grain (sign text). */
export function markAsSign(material: Material & { mrtNode?: unknown }): void {
  material.mrtNode = mrt({ signMask: float(1) });
}

export class PostPipeline {
  pipeline!: RenderPipeline;
  /** Live-tweakable from the debug overlay. */
  readonly uniforms = {
    outlineStrength: uniform(0),
    outlineThreshold: uniform(0),
    bands: uniform(0),
    posterizeMix: uniform(0),
    grain: uniform(0),
    vignette: uniform(0),
    ca: uniform(0),
  };

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    readonly settings: PostSettings = DEFAULT_POST,
  ) {
    this.apply(settings);
  }

  apply(s: PostSettings): void {
    const u = this.uniforms;
    u.outlineStrength.value = s.outlineStrength;
    u.outlineThreshold.value = s.outlineThreshold;
    u.bands.value = s.posterizeBands;
    u.posterizeMix.value = s.posterizeMix;
    u.grain.value = s.grain;
    u.vignette.value = s.vignette;
    u.ca.value = s.chromaticAberration;
  }

  build(): void {
    const u = this.uniforms;
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, signMask: float(0) }));
    const color = scenePass.getTextureNode('output');
    const mask = scenePass.getTextureNode('signMask').x;
    const depth = scenePass.getTextureNode('depth');

    // Chromatic aberration grows towards the edges, like a cheap lens.
    const dir = uv().sub(0.5);
    const shifted = vec4(
      color.sample(uv().add(dir.mul(u.ca))).x,
      color.y,
      color.sample(uv().sub(dir.mul(u.ca))).z,
      1,
    );
    const display = renderOutput(shifted).xyz; // tone mapping + sRGB, before banding
    const clean = renderOutput(color).xyz;

    // 8-sample Sobel on view-space depth, normalised by distance so far walls aren't all lines.
    const texel = vec2(1).div(screenSize);
    const viewDepth = (dx: number, dy: number) =>
      perspectiveDepthToViewZ(depth.sample(uv().add(texel.mul(vec2(dx, dy)))).x, cameraNear, cameraFar).negate();
    const tl = viewDepth(-1, 1), tc = viewDepth(0, 1), tr = viewDepth(1, 1);
    const ml = viewDepth(-1, 0), mr = viewDepth(1, 0);
    const bl = viewDepth(-1, -1), bc = viewDepth(0, -1), br = viewDepth(1, -1);
    const gx = tr.add(mr.mul(2)).add(br).sub(tl).sub(ml.mul(2)).sub(bl);
    const gy = tl.add(tc.mul(2)).add(tr).sub(bl).sub(bc.mul(2)).sub(br);
    const centre = max(viewDepth(0, 0), float(0.3));
    const edge = smoothstep(u.outlineThreshold, u.outlineThreshold.mul(2), length(vec2(gx, gy)).div(centre));
    const outlined = display.mul(float(1).sub(edge.mul(u.outlineStrength)));

    // Posterise in display space, blended with the original so it isn't too crunchy.
    const banded = floor(outlined.mul(u.bands)).div(u.bands);
    const posterised = mix(outlined, banded, u.posterizeMix);

    // Vignette and per-frame film grain.
    const vig = smoothstep(0.85, 0.25, length(dir.mul(vec2(1.2, 1))));
    const grain = rand(uv().mul(screenSize).add(vec2(floor(time.mul(24)), 0))).sub(0.5).mul(u.grain);
    const styled = posterised.mul(mix(float(1), vig, u.vignette)).add(vec3(grain));

    this.pipeline = new RenderPipeline(this.renderer);
    this.pipeline.outputColorTransform = false; // done above, before banding
    this.pipeline.outputNode = vec4(mix(styled, clean, mask), 1);
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline?.dispose();
  }
}
