/**
 * Runs one synchronous operation while an ordinary inherited accessor named `key` exists on
 * Object.prototype. The setter counts hits; the getter answers `inherited` (default undefined),
 * which lets a test prove that an omitted field is never read through the prototype. Callers
 * assert only after this returns, once the prototype is restored, so no assertion runs under
 * the hook.
 */
export function withNamedAccessor<T>(key: string, operation: () => T, inherited?: unknown): { value: T; setterHits: number } {
  const saved = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let setterHits = 0;
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() { return inherited; },
      set() { setterHits++; },
    });
    const value = operation();
    return { value, setterHits };
  } finally {
    if (saved) Object.defineProperty(Object.prototype, key, saved);
    else Reflect.deleteProperty(Object.prototype, key);
  }
}

/** Same hook across an awaited operation, for paths that are genuinely asynchronous. */
export async function withNamedAccessorAsync<T>(key: string, operation: () => Promise<T>, inherited?: unknown): Promise<{ value: T; setterHits: number }> {
  const saved = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let setterHits = 0;
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() { return inherited; },
      set() { setterHits++; },
    });
    const value = await operation();
    return { value, setterHits };
  } finally {
    if (saved) Object.defineProperty(Object.prototype, key, saved);
    else Reflect.deleteProperty(Object.prototype, key);
  }
}
