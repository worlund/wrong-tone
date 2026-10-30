// Every gameplay event in one typed map. Word events feed the language log (and FSRS in M4).

export type Facet = 'read' | 'listen' | 'speak' | 'write' | 'silence';
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface WordEvent {
  hanzi: string;
  pinyin: string;
  meaning: string;
  facet: Facet;
  correct: boolean;
  /** Seconds from the prompt appearing to the player's decision. */
  responseTime: number;
  grade: Grade;
  /** For spoken words: the target and detected tones, and the pitch contour (semitones). */
  speech?: { target: number; heard: number; probs: number[]; contour: number[]; source: 'mic' | 'keys' };
}

type Pos = { x: number; y: number; z: number };

export type GameEvents = {
  word: WordEvent;
  /** A line spoken by a character, shown as a subtitle. */
  voice: { hanzi: string; pinyin: string; meaning: string; position?: Pos };
  sound: { cue: string; position?: Pos };
  /** Wrong door: fade out, back to spawn. */
  ghostWall: Record<string, never>;
  caught: Record<string, never>;
  delivered: Record<string, never>;
  /** The room went back to the start of the golden path. */
  runReset: Record<string, never>;
};
