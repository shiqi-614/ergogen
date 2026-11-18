// A key-value store with expiry for what ergogen fetches from GitHub: in localStorage in a browser (one key per
// cache), else in memory.

// Every cache once shared this one localStorage key, with keys of the same form (repo/file): after a reload each read
// the others' values. It is removed.
const LEGACY_STORAGE_KEY = 'ergocai_cache_store';

// every cache, so a changed GitHub file can be dropped from all of them
const instances = [];

class Cache {
  // name: the cache's own, its localStorage key; usePersistent false keeps it in memory in a browser too
  constructor(name, ttl = 24 * 60 * 60 * 1000, usePersistent = true) {
    this.ttl = ttl;
    this.usePersistent = usePersistent;

    this.isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    if (this.isBrowser && this.usePersistent) {
      this.storageKey = `ergocai_cache_${name}`;
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      this._loadFromStorage();
      // a pending write must not be lost when the page goes away
      window.addEventListener('pagehide', () => this._flush());
    } else {
      this.store = new Map();
    }
    instances.push(this);
  }

  // Drops the files at `paths` of a GitHub repo ("owner/name") from every cache, or all of the repo's files when
  // paths is null. Keys are "repo/file"; some callers give the repo with a trailing slash, hence the doubled ones.
  static forget(repo, paths) {
    const keys = paths && new Set(paths.map(path => `${repo}/${path}`));
    for (const cache of instances) {
      let dropped = false;
      for (const key of [...cache.store.keys()]) {
        const plain = key.replace(/\/{2,}/g, '/');
        if (keys ? keys.has(plain) : plain.startsWith(`${repo}/`)) {
          cache.store.delete(key);
          dropped = true;
        }
      }
      if (dropped) cache._scheduleSave();
    }
  }

  // the stored entries that have not expired (the expired ones are written away)
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this.store = new Map();
        const now = Date.now();
        let dropped = false;
        for (const [key, entry] of Object.entries(data)) {
          if (entry.expire > now) {
            this.store.set(key, entry);
          } else {
            dropped = true;
          }
        }
        if (dropped) this._saveToStorage();
      } else {
        this.store = new Map();
      }
    } catch (error) {
      console.error('Failed to load cache from storage:', error);
      this.store = new Map();
    }
  }

  _saveToStorage() {
    if (!this.isBrowser || !this.usePersistent) return;

    try {
      const data = {};
      for (const [key, entry] of this.store.entries()) {
        data[key] = entry;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save cache to storage:', error);
    }
  }

  // Writing re-serializes the whole store, so a burst of inserts (a cold run fetches dozens of files) is written
  // once, a second after the last change, instead of once per insert.
  _scheduleSave() {
    if (!this.isBrowser || !this.usePersistent || this._saveTimer) return;
    this._saveTimer = setTimeout(() => this._flush(), 1000);
  }

  _flush() {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._saveToStorage();
  }

  _isExpired(entry) {
    return entry.expire <= Date.now();
  }

  set(key, value) {
    const entry = {
      value,
      expire: Date.now() + this.ttl
    };

    this.store.set(key, entry);

    this._scheduleSave();

    return this;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.store.delete(key);
      this._scheduleSave();
      return undefined;
    }

    return entry.value;
  }

  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (this._isExpired(entry)) {
      this.store.delete(key);
      this._scheduleSave();
      return false;
    }

    return true;
  }

  clear() {
    this.store.clear();
    if (this.isBrowser && this.usePersistent) {
      localStorage.removeItem(this.storageKey);
    }
  }

  delete(key) {
    const deleted = this.store.delete(key);
    if (deleted) this._scheduleSave();
    return deleted;
  }

  size() {
    return this.store.size;
  }

  keys() {
    return Array.from(this.store.keys());
  }
}

module.exports = Cache;