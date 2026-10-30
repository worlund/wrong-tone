// Typed, synchronous event bus. Simulation systems emit; other systems, audio,
// the HUD and the language log listen. Handlers run in subscription order.

export type EventMap = Record<string, unknown>;
export type Unsubscribe = () => void;

type Handler = (event: never) => void;

export class EventBus<E extends EventMap> {
  private handlers = new Map<keyof E, Handler[]>();

  on<K extends keyof E>(type: K, handler: (event: E[K]) => void): Unsubscribe {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as Handler);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type);
      if (!current) return;
      // Replace rather than splice, so an emit in progress keeps its snapshot.
      this.handlers.set(type, current.filter((h) => h !== handler));
    };
  }

  emit<K extends keyof E>(type: K, event: E[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const h of list) (h as (event: E[K]) => void)(event);
  }

  clear(): void {
    this.handlers.clear();
  }
}
