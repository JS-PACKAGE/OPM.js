const FOREIGN = Object.freeze({ foreign: true });
const INDICES = 4;

/**
 * Runs one synchronous operation while ordinary inherited accessors exist at the first array
 * indices. Counters are scalars: recording hits in an array would re-enter the accessors under
 * test. Callers assert only after this returns, once the prototype is restored.
 */
export function withIndexedAccessors<T>(operation: () => T): { value: T; setterHits: number; getterReads: number } {
  const saved = [0, 1, 2, 3].map(index => Object.getOwnPropertyDescriptor(Array.prototype, String(index)));
  let setterHits = 0;
  let getterReads = 0;
  try {
    for (let index = 0; index < INDICES; index++) {
      Object.defineProperty(Array.prototype, String(index), {
        configurable: true,
        set() { setterHits++; },
        get() { getterReads++; return FOREIGN; },
      });
    }
    return { value: operation(), setterHits, getterReads };
  } finally {
    for (let index = 0; index < INDICES; index++) {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(Array.prototype, String(index), descriptor);
      else Reflect.deleteProperty(Array.prototype, String(index));
    }
  }
}
