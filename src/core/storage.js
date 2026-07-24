/**
 * Typed-safe storage boundary. Business modules must not parse localStorage directly.
 */
export function readJson(storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
  return value;
}

export function readArray(storage, key) {
  const value = readJson(storage, key, []);
  return Array.isArray(value) ? value : [];
}

