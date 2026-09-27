import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Hub Firestore Storage Adapter for Jourvance.
 * Provides durable cloud persistence via hub.store.docs with an in-memory cache,
 * debounced local file backups, and automatic startup migration/rehydration.
 */

class HubStorageManager {
  constructor() {
    this.hub = null;
    this.hubReady = false;
    this.dataDir = process.cwd();
    this.memoryCache = new Map();
    this.dirtyKeys = new Set();
    this.flushTimers = new Map();
    this.behaviorDirtyUids = new Set();
    this.behaviorFlushTimer = null;
    this.initialized = false;
  }

  init({ hub, hubReady, dataDir }) {
    this.hub = hub;
    this.hubReady = Boolean(hubReady && hub?.store?.docs);
    this.dataDir = dataDir || process.cwd();

    // Setup periodic behavior buffer flush (every 5 seconds)
    if (!this.behaviorFlushTimer) {
      this.behaviorFlushTimer = setInterval(() => {
        this.flushDirtyBehavior().catch((err) => {
          console.warn('[Jourvance Storage] Periodic behavior flush warning:', err.message);
        });
      }, 5000);
      if (this.behaviorFlushTimer.unref) this.behaviorFlushTimer.unref();
    }

    // Flush dirty buffers before process exit
    const cleanup = () => {
      this.flushDirtyBehaviorSync();
      this.flushAllDirtySync();
    };
    process.once('beforeExit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    this.initialized = true;
  }

  filePath(filename) {
    return path.join(this.dataDir, filename);
  }

  readLocalJson(filename, fallback) {
    try {
      const file = this.filePath(filename);
      if (!fs.existsSync(file)) return fallback;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data ?? fallback;
    } catch {
      return fallback;
    }
  }

  writeLocalJson(filename, data) {
    try {
      const file = this.filePath(filename);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[Jourvance Storage] Failed writing local ${filename}:`, err.message);
    }
  }

  // ── Core Key-Value Document API ─────────────────────────────────────────────

  get(docKey, filename, fallback) {
    if (this.memoryCache.has(docKey)) {
      return this.memoryCache.get(docKey);
    }
    const local = this.readLocalJson(filename, fallback);
    this.memoryCache.set(docKey, local);
    return local;
  }

  set(docKey, filename, data, options = {}) {
    this.memoryCache.set(docKey, data);
    
    // Always write to local file as secondary/fallback
    if (options.immediateDisk) {
      this.writeLocalJson(filename, data);
    } else {
      this.scheduleDiskWrite(filename, data);
    }

    // Write through to Hub Firestore
    if (this.hubReady) {
      this.scheduleHubPut(docKey, data, options.debounceMs || 1000);
    }
  }

  scheduleDiskWrite(filename, data) {
    if (!this.pendingDiskWrites) this.pendingDiskWrites = new Map();
    this.pendingDiskWrites.set(filename, data);
    if (this.flushTimers.has(filename)) return;
    const timer = setTimeout(() => {
      this.flushTimers.delete(filename);
      const latestData = this.pendingDiskWrites.get(filename);
      this.pendingDiskWrites.delete(filename);
      this.writeLocalJson(filename, latestData);
    }, 1500);
    if (timer.unref) timer.unref();
    this.flushTimers.set(filename, timer);
  }

  scheduleHubPut(docKey, data, debounceMs = 1000) {
    if (!this.pendingHubPuts) this.pendingHubPuts = new Map();
    this.pendingHubPuts.set(docKey, data);
    const timerKey = `hub:${docKey}`;
    if (this.flushTimers.has(timerKey)) {
      clearTimeout(this.flushTimers.get(timerKey));
    }
    const timer = setTimeout(async () => {
      this.flushTimers.delete(timerKey);
      const latestData = this.pendingHubPuts.get(docKey);
      this.pendingHubPuts.delete(docKey);
      try {
        await this.hub.store.docs.put(docKey, latestData);
      } catch (err) {
        console.warn(`[Jourvance Storage] Failed remote put for ${docKey}:`, err.message);
      }
    }, debounceMs);
    if (timer.unref) timer.unref();
    this.flushTimers.set(timerKey, timer);
  }

  // ── Storefront Behavior Batching & Buffering ───────────────────────────────

  loadBehaviorBag(uid) {
    const all = this.get('store.behavior', 'behavior.json', {});
    const bag = all && typeof all === 'object' ? all[uid] : null;
    return {
      events: Array.isArray(bag?.events) ? bag.events : [],
      subscriptions: Array.isArray(bag?.subscriptions) ? bag.subscriptions : []
    };
  }

  pushBehavior(uid, event) {
    if (!uid) return;
    const all = this.get('store.behavior', 'behavior.json', {});
    if (!all[uid]) {
      all[uid] = { events: [], subscriptions: [] };
    }
    all[uid].events = Array.isArray(all[uid].events) ? all[uid].events : [];
    all[uid].events.push(event);
    if (all[uid].events.length > 50000) {
      all[uid].events = all[uid].events.slice(-50000);
    }
    this.memoryCache.set('store.behavior', all);
    this.behaviorDirtyUids.add(uid);
  }

  async flushDirtyBehavior() {
    if (!this.behaviorDirtyUids.size) return;
    this.behaviorDirtyUids.clear();
    const all = this.get('store.behavior', 'behavior.json', {});
    this.writeLocalJson('behavior.json', all);
    if (this.hubReady) {
      try {
        await this.hub.store.docs.put('store.behavior', all);
      } catch (err) {
        console.warn('[Jourvance Storage] Remote behavior sync notice:', err.message);
      }
    }
  }

  flushDirtyBehaviorSync() {
    if (!this.behaviorDirtyUids.size) return;
    try {
      const all = this.get('store.behavior', 'behavior.json', {});
      this.writeLocalJson('behavior.json', all);
    } catch {}
  }

  flushAllDirtySync() {
    for (const [timerKey, timer] of this.flushTimers.entries()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    if (this.pendingDiskWrites) {
      for (const [filename, data] of this.pendingDiskWrites.entries()) {
        this.writeLocalJson(filename, data);
      }
      this.pendingDiskWrites.clear();
    }
  }

  // ── Startup Rehydration & Migration ────────────────────────────────────────

  async rehydrateAll({
    workspaceCache,
    publicPageCache,
    sanitizeWorkspace
  }) {
    if (!this.hubReady) {
      console.log('[Jourvance Storage] Operating in local fallback mode (HUB_API_KEY unset).');
      return { success: true, mode: 'local' };
    }

    console.log('[Jourvance Storage] Starting Hub Firestore rehydration and sync...');

    const coreStores = [
      { key: 'store.contacts', file: 'contacts.json', isArray: true },
      { key: 'store.orders', file: 'orders.json', isArray: true },
      { key: 'store.checkouts', file: 'checkouts.json', isArray: true },
      { key: 'store.campaigns', file: 'campaigns.json', isArray: true },
      { key: 'store.drips', file: 'drips.json', isArray: false },
      { key: 'store.discounts', file: 'discounts.json', isArray: true },
      { key: 'store.events', file: 'events.json', isArray: true },
      { key: 'store.redirects', file: 'redirects.json', isArray: true },
      { key: 'store.email_programs', file: 'email_programs.json', isArray: false },
      { key: 'store.signup_forms', file: 'signup_forms.json', isArray: false },
      { key: 'store.predictions', file: 'predictions.json', isArray: false },
      { key: 'store.behavior', file: 'behavior.json', isArray: false },
      { key: 'store.catalog_memory', file: 'catalog_memory.json', isArray: false },
      { key: 'store.klaviyo', file: 'klaviyo.json', isArray: false }
    ];

    let rehydratedCount = 0;
    let migratedCount = 0;

    for (const item of coreStores) {
      const localData = this.readLocalJson(item.file, item.isArray ? [] : {});
      try {
        const res = await this.hub.store.docs.get(item.key);
        if (res?.document) {
          // Hub store is the durable truth: rehydrate memory and update local mirror
          this.memoryCache.set(item.key, res.document);
          this.writeLocalJson(item.file, res.document);
          rehydratedCount++;
        } else {
          // Document does not exist on Hub yet: migrate local disk data to Hub
          const hasLocalData = item.isArray ? Array.isArray(localData) && localData.length > 0 : Object.keys(localData || {}).length > 0;
          if (hasLocalData) {
            await this.hub.store.docs.put(item.key, localData);
            this.memoryCache.set(item.key, localData);
            migratedCount++;
            console.log(`[Jourvance Storage] Migrated local ${item.file} -> Hub doc ${item.key}`);
          } else {
            this.memoryCache.set(item.key, item.isArray ? [] : {});
          }
        }
      } catch (err) {
        // Fallback to local data on network failure
        this.memoryCache.set(item.key, localData);
      }
    }

    // Rehydrate Workspaces and Public Pages so fresh container boots never fail webhooks
    try {
      const list = await this.hub.store.docs.list();
      const docs = Array.isArray(list?.documents) ? list.documents : [];
      
      const wsDocNames = docs.map((d) => d.name).filter((n) => n.startsWith('workspace.'));
      if (wsDocNames.length) {
        const wsBatch = await this.hub.store.docs.batchGet(wsDocNames.slice(0, 50));
        for (const item of wsBatch?.documents || []) {
          if (item?.found && item.document && item.document.userId && item.document.id) {
            const sanitized = sanitizeWorkspace ? sanitizeWorkspace(item.document) : item.document;
            workspaceCache[`${item.document.userId}:${item.document.id}`] = sanitized;
          }
        }
      }

      // Check if any local workspaces are missing from Hub and upload them
      for (const [key, ws] of Object.entries(workspaceCache)) {
        if (!ws?.id || !ws?.userId) continue;
        const safeUid = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(ws.userId) ? ws.userId : crypto.createHash('sha256').update(String(ws.userId)).digest('hex').slice(0, 24);
        const name = `workspace.${safeUid}.${crypto.createHash('sha256').update(String(ws.id)).digest('hex').slice(0, 16)}`;
        if (!wsDocNames.includes(name)) {
          await this.hub.store.docs.put(name, ws).catch(() => {});
        }
      }

      const pubDocNames = docs.map((d) => d.name).filter((n) => n.startsWith('pubpage.'));
      if (pubDocNames.length) {
        const pubBatch = await this.hub.store.docs.batchGet(pubDocNames.slice(0, 50));
        for (const item of pubBatch?.documents || []) {
          if (item?.found && item.document && item.document.slug) {
            publicPageCache[item.document.slug] = item.document;
          }
        }
      }
    } catch (err) {
      console.warn('[Jourvance Storage] Warning during workspace/publicPage rehydration:', err.message);
    }

    console.log(`[Jourvance Storage] Rehydration complete: ${rehydratedCount} stores loaded from Hub, ${migratedCount} migrated to Hub.`);
    return { success: true, rehydratedCount, migratedCount };
  }
}

export const hubStorage = new HubStorageManager();
export default hubStorage;
