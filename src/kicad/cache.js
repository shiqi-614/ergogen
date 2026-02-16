class Cache {
  constructor() {
    this.ttl = 24 * 60 * 60 * 1000;
    this.store = new Map();
  }

  _isExpired(entry) {
    return entry.expire <= Date.now()
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expire: Date.now() + this.ttl
    })
  }

  get(key) {
    const entry = this.store.get(key)
    if (!entry) return undefined

    if (this._isExpired(entry)) {
      this.store.delete(key)
      return undefined
    }

    return entry.value
  }

  has(key) {
    const entry = this.store.get(key)
    if (!entry) return false

    if (this._isExpired(entry)) {
      this.store.delete(key)
      return false
    }

    return true
  }
}
module.exports = Cache;

