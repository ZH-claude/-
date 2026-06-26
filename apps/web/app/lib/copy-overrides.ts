type PlainObject = Record<string, unknown>;

export type CopyValueOverride<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<U>
    : T extends Record<string, unknown>
      ? { [K in keyof T]?: CopyValueOverride<T[K]> }
      : T;

export type CopyOverrides<T> = {
  [K in keyof T]?: CopyValueOverride<T[K]>;
};

const isPlainObject = (value: unknown): value is PlainObject => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const mergeNode = <T>(base: T, override: unknown): T => {
  if (override === undefined) {
    return base;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const next: PlainObject = { ...base };

    for (const [key, overrideValue] of Object.entries(override)) {
      const baseValue = next[key];

      if (Array.isArray(overrideValue) || Array.isArray(baseValue)) {
        next[key] = overrideValue;
        continue;
      }

      if (overrideValue === undefined) {
        continue;
      }

      if (isPlainObject(baseValue)) {
        next[key] = mergeNode(baseValue, overrideValue);
      } else {
        next[key] = overrideValue;
      }
    }

    return next as T;
  }

  return override as T;
};

export function applyCopyOverrides<T>(base: T, ...overrides: Array<CopyOverrides<T> | null | undefined>): T {
  let merged = base;
  for (const override of overrides) {
    if (override == null) {
      continue;
    }
    merged = mergeNode(merged, override);
  }
  return merged;
}
