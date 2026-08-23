export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();

const memoryStorage: KeyValueStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};

export function getLocalStorage(): KeyValueStorage {
  if (typeof globalThis.localStorage !== 'undefined') return globalThis.localStorage;
  return memoryStorage;
}

export function createNamespacedStorage(namespace: string, storage: KeyValueStorage = getLocalStorage()) {
  return {
    get(key: string) {
      return storage.getItem(`${namespace}:${key}`);
    },
    set(key: string, value: string) {
      storage.setItem(`${namespace}:${key}`, value);
    },
    remove(key: string) {
      storage.removeItem(`${namespace}:${key}`);
    },
  };
}
