import '@testing-library/jest-dom';

// Node 22+ ships a built-in `localStorage` global that requires
// `--localstorage-file=<path>` to actually persist data; without it, the
// accessor returns a non-functional stub (`localStorage.setItem is not a
// function`). That built-in global shadows jsdom's working Storage
// implementation in the test environment (both `localStorage` and
// `window.localStorage` resolve to the same broken accessor here), which
// breaks any code under test that touches localStorage. Replace it with a
// simple in-memory Storage implementation so tests get real, working
// localStorage regardless of the Node version running them.
class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});
