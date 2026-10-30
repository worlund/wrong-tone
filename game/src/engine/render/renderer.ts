// Creates the three.js WebGPURenderer (falls back to WebGL 2 automatically) and
// renders at a fixed low internal resolution, upscaled with nearest-neighbour CSS.

import { WebGPURenderer, PerspectiveCamera, Scene, ACESFilmicToneMapping } from 'three/webgpu';
import type { Service } from '../core/system';
import { PostPipeline } from './post';

export type Backend = 'webgpu' | 'webgl2';

export interface RenderOptions {
  /** Internal render height in pixels; width follows the window's aspect ratio. */
  internalHeight: number;
  /** Testing aid: force the WebGL 2 backend (also reachable with ?webgl in the URL). */
  forceWebGL: boolean;
  fov: number;
  near: number;
  far: number;
}

export const DEFAULT_RENDER: RenderOptions = { internalHeight: 520, forceWebGL: false, fov: 70, near: 0.05, far: 60 };

export class Renderer implements Service {
  readonly name = 'renderer';
  renderer!: WebGPURenderer;
  scene = new Scene();
  camera: PerspectiveCamera;
  post!: PostPipeline;
  backend: Backend = 'webgpu';
  private readonly onResize = () => this.resize();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly options: RenderOptions = DEFAULT_RENDER,
  ) {
    this.camera = new PerspectiveCamera(options.fov, 1, options.near, options.far);
    this.camera.rotation.order = 'YXZ'; // yaw, then pitch: no roll creeping in
  }

  async init(): Promise<void> {
    const forceWebGL = this.options.forceWebGL || new URLSearchParams(location.search).has('webgl');
    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false, // the low-res, point-filtered look is intentional
      forceWebGL,
    });
    await this.renderer.init();
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setPixelRatio(1);
    this.post = new PostPipeline(this.renderer, this.scene, this.camera);
    this.post.build();
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** Internal resolution for the current window size. */
  internalSize(): { width: number; height: number } {
    const height = this.options.internalHeight;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    return { width: Math.round(height * aspect), height };
  }

  private resize(): void {
    const { width, height } = this.internalSize();
    this.renderer.setSize(width, height, false); // CSS stretches the canvas to the window
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.post.render();
  }

  /**
   * Compiles every pipeline the scene can need before play starts, so the first time an object
   * comes into view (or a shadow pass runs) doesn't stall a frame. Call after the level is built.
   */
  async warmup(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
    // compileAsync doesn't cover everything (post passes, shadow variants): render one frame
    // with culling off so every object is actually drawn once.
    const culled: { frustumCulled: boolean }[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    this.post.render();
    for (const o of culled) o.frustumCulled = true;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.post?.dispose();
    this.renderer?.dispose();
  }
}
