class Cache {
  constructor(ttl = 24 * 60 * 60 * 1000, usePersistent = true) {
    this.ttl = ttl;
    this.usePersistent = usePersistent;

    // 检测是否在浏览器环境
    this.isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    if (this.isBrowser && this.usePersistent) {
      // 浏览器环境使用 localStorage
      this.storageKey = 'app_cache_store';
      this._loadFromStorage();
    } else {
      // Node.js 或非持久化模式使用 Map
      this.store = new Map();
    }
  }

  // 从 localStorage 加载数据
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        // 过滤掉已过期的数据
        this.store = new Map();
        const now = Date.now();
        for (const [key, entry] of Object.entries(data)) {
          if (entry.expire > now) {
            this.store.set(key, entry);
          }
        }
        this._saveToStorage();
      } else {
        this.store = new Map();
      }
    } catch (error) {
      console.error('Failed to load cache from storage:', error);
      this.store = new Map();
    }
  }

  // 保存到 localStorage
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

  _isExpired(entry) {
    return entry.expire <= Date.now();
  }

  set(key, value) {
    const entry = {
      value,
      expire: Date.now() + this.ttl
    };

    this.store.set(key, entry);

    // 持久化存储
    if (this.isBrowser && this.usePersistent) {
      this._saveToStorage();
    }

    return this;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.store.delete(key);
      if (this.isBrowser && this.usePersistent) {
        this._saveToStorage();
      }
      return undefined;
    }

    return entry.value;
  }

  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (this._isExpired(entry)) {
      this.store.delete(key);
      if (this.isBrowser && this.usePersistent) {
        this._saveToStorage();
      }
      return false;
    }

    return true;
  }

  // 清除所有缓存
  clear() {
    this.store.clear();
    if (this.isBrowser && this.usePersistent) {
      localStorage.removeItem(this.storageKey);
    }
  }

  // 删除指定 key
  delete(key) {
    const deleted = this.store.delete(key);
    if (deleted && this.isBrowser && this.usePersistent) {
      this._saveToStorage();
    }
    return deleted;
  }

  // 获取缓存大小
  size() {
    return this.store.size;
  }

  // 获取所有 keys
  keys() {
    return Array.from(this.store.keys());
  }
}

module.exports = Cache;