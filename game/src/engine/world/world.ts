// Small typed entity store. Components are plain serialisable data so a host can
// snapshot the world for co-op later. No ECS library: v1 has under 100 entities.

export type Entity = number;

/** A component type: a unique key plus a type parameter for its data. */
export interface ComponentType<T> {
  readonly name: string;
  /** Phantom field so different component types aren't interchangeable. */
  readonly __data?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
}

export class World {
  private nextId = 1;
  /** Live entities in creation order. */
  private alive = new Set<Entity>();
  private stores = new Map<string, Map<Entity, unknown>>();
  /** Query results are cached until the next structural change, so hot loops don't allocate. */
  private queryCache = new Map<string, Entity[]>();

  createEntity(): Entity {
    const e = this.nextId++;
    this.alive.add(e);
    this.queryCache.clear();
    return e;
  }

  destroyEntity(e: Entity): void {
    if (!this.alive.delete(e)) return;
    for (const store of this.stores.values()) store.delete(e);
    this.queryCache.clear();
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  add<T>(e: Entity, type: ComponentType<T>, data: T): T {
    if (!this.alive.has(e)) throw new Error(`add ${type.name}: entity ${e} is not alive`);
    let store = this.stores.get(type.name);
    if (!store) this.stores.set(type.name, (store = new Map()));
    if (!store.has(e)) this.queryCache.clear();
    store.set(e, data);
    return data;
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.name)?.get(e) as T | undefined;
  }

  /** Like get(), but throws when missing: for components a system requires. */
  require<T>(e: Entity, type: ComponentType<T>): T {
    const c = this.get(e, type);
    if (c === undefined) throw new Error(`entity ${e} has no ${type.name}`);
    return c;
  }

  remove<T>(e: Entity, type: ComponentType<T>): void {
    if (this.stores.get(type.name)?.delete(e)) this.queryCache.clear();
  }

  /** Entities that have every listed component, in creation order. Do not mutate the result. */
  query(...types: ComponentType<unknown>[]): readonly Entity[] {
    const key = types.map((t) => t.name).join('|');
    let result = this.queryCache.get(key);
    if (!result) {
      const stores = types.map((t) => this.stores.get(t.name));
      result = stores.some((s) => !s)
        ? []
        : [...this.alive].filter((e) => stores.every((s) => s!.has(e)));
      this.queryCache.set(key, result);
    }
    return result;
  }

  /** First entity with all listed components, if any. */
  first(...types: ComponentType<unknown>[]): Entity | undefined {
    return this.query(...types)[0];
  }
}
