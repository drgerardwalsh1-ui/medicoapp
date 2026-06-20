// Pull in the Temporal polyfill once so every test file can rely on the
// global `Temporal` namespace. Avoids re-importing in each test.
import "@js-temporal/polyfill";

// Node ≥22 defines a global `localStorage` getter that is non-functional
// unless --localstorage-file is set, and it shadows jsdom's Storage in the
// jsdom test environment. Replace it with a working in-memory Storage so
// localStorage-backed modules (templateStore, interview ticks, clinician
// session) behave identically in tests and in the real webview.
const broken = (() => {
  try {
    return typeof globalThis.localStorage?.setItem !== "function";
  } catch {
    return true;
  }
})();
if (broken) {
  const map = new Map<string, string>();
  const storage: Storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(String(k), String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}
