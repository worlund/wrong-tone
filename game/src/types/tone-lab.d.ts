// Types for the parts of tone-lab's plain-JS tone-core the game uses.

declare module 'tone-lab/tone-core.js' {
  export interface PitchFrame {
    t: number;
    f0: number;
    clarity: number;
    db: number;
  }
  export interface Contour {
    st: number[];
    rawT: number[];
    rawSt: number[];
    duration: number;
    creak: number;
  }
  export interface SpeakerModel {
    add(stValues: number[]): void;
    calibrate(stValues: number[]): boolean;
    range(): { lo: number; hi: number } | null;
    reset(): void;
    toChao(st: number): number | null;
  }
  export interface Segmenter {
    push(frame: PitchFrame): PitchFrame[] | null;
    readonly active: boolean;
    gateDb: number;
  }
  export function createSegmenter(opts?: { gateDb?: number }): Segmenter;
  export function extractContour(frames: PitchFrame[]): Contour | null;
  export function createSpeakerModel(): SpeakerModel;
  export function classifyTone(
    contour: Pick<Contour, 'st' | 'duration' | 'creak'>,
    speaker: SpeakerModel | null,
  ): { probs: [number, number, number, number]; best: number; meanChao: number | null };
  export function templateCurve(points: [number, number][], n?: number): number[];
}
