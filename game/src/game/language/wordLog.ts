// Collects word events for the incident report now, and for the FSRS deck in M4.

import type { EventBus } from '../../engine/core/events';
import type { GameEvents, Grade, WordEvent } from '../events';

/** Grade from play: wrong = again, slow = hard, otherwise good. Thresholds per facet in M4. */
export function inferGrade(correct: boolean, responseTime: number, slowAfterSec = 6): Grade {
  if (!correct) return 'again';
  return responseTime > slowAfterSec ? 'hard' : 'good';
}

export class WordLog {
  readonly events: (WordEvent & { first: boolean })[] = [];
  /** Words already graded this session: only the first appearance counts for scheduling. */
  private graded = new Set<string>();

  /** Records every 'word' event from the bus. Returns an unsubscribe function. */
  listen(bus: EventBus<GameEvents>): () => void {
    return bus.on('word', (e) => this.record(e));
  }

  record(event: WordEvent): void {
    const key = `${event.hanzi}:${event.facet}`;
    this.events.push({ ...event, first: !this.graded.has(key) });
    this.graded.add(key);
  }

  isFirstAppearance(hanzi: string, facet: string): boolean {
    return !this.graded.has(`${hanzi}:${facet}`);
  }

  clear(): void {
    this.events.length = 0;
    this.graded.clear();
  }
}
