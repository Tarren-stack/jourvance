import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Hub storage for Jourvance.
 *
 * The process keeps one combined value per collection, which is what every loader
 * already reads. The hub copy is one document per account, so one account's contacts,
 * events, drips, or behavior cannot grow into another account's document.
 * A slice document is `{ _jourvanceAccount, value }`. The account id lives in the
 * document because a uid that is not a safe path segment is hashed in the name.
 * Shared drip sequence definitions stay on `store.drips.sequences`. Enrollments
 * are per account. Rows with no owner stay on `*.none` and are not given an owner here.
 */

export const UNOWNED = '';
export const BATCH_SIZE = 20;
const SYNC_FILE = 'storage-sync.json';

export const TENANT_SPECS = {
  'store.contacts': { file: 'contacts.json', kind: 'array', owner: 'userId' },
  'store.orders': { file: 'orders.json', kind: 'array', owner: 'userId' },
  'store.checkouts': { file: 'checkouts.json', kind: 'array', owner: 'userId' },
  'store.campaigns': { file: 'campaigns.json', kind: 'array', owner: 'userId' },
  'store.discounts': { file: 'discounts.json', kind: 'array', owner: 'userId' },
  'store.events': { file: 'events.json', kind: 'array', owner: 'userId' },
  'store.redirects': { file: 'redirects.json', kind: 'array', owner: 'uid' },
  'store.reviews': { file: 'reviews.json', kind: 'array', owner: 'userId' },
  'store.templates': { file: 'templates.json', kind: 'array', owner: 'userId' },
  'store.email_programs': { file: 'email_programs.json', kind: 'map' },
  'store.signup_forms': { file: 'signup_forms.json', kind: 'map' },
  'store.predictions': { file: 'predictions.json', kind: 'map' },
  'store.behavior': { file: 'behavior.json', kind: 'map' },
  'store.catalog_memory': { file: 'catalog_memory.json', kind: 'map' },
  'store.klaviyo': { file: 'klaviyo.json', kind: 'map' },
  'store.drips': { file: 'drips.json', kind: 'drips' }
};

export function safeAccountId(uid) {
  const s = String(uid || '');
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)) return s;
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
}

export function workspaceDocName(uid, wsId) {
  return `workspace.${safeAccountId(uid)}.${crypto.createHash('sha256').update(String(wsId)).digest('hex').slice(0, 16)}`;
}

export function pageDocName(slug) {
  return `pubpage.${safeAccountId(slug)}`;
}

export function accountDocName(collectionKey, accountId) {
  if (accountId === UNOWNED) return `${collectionKey}.none`;
  return `${collectionKey}.u.${safeAccountId(accountId)}`;
}

export function sequencesDocName(collectionKey) {
  return `${collectionKey}.sequences`;
}

export function ownerIdOf(row, field) {
  const id = row && typeof row === 'object' ? String(row[field] || '').trim() : '';
  return id || UNOWNED;
}

export function partitionTenant(spec, data) {
  const parts = new Map();
  if (spec.kind === 'array') {
    for (const row of Array.isArray(data) ? data : []) {
      const id = ownerIdOf(row, spec.owner);
      if (!parts.has(id)) parts.set(id, []);
      parts.get(id).push(row);
    }
    return { parts, sequences: null };
  }
  if (spec.kind === 'map') {
    const obj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    for (const [id, value] of Object.entries(obj)) {
      if (!id) continue;
      parts.set(id, value);
    }
    return { parts, sequences: null };
  }
  const sequences = Array.isArray(data?.sequences) ? data.sequences : [];
  for (const row of Array.isArray(data?.enrollments) ? data.enrollments : []) {
    const id = ownerIdOf(row, 'userId');
    if (!parts.has(id)) parts.set(id, []);
    parts.get(id).push(row);
  }
  return { parts, sequences };
}

export function combineTenant(spec, legacy, slices, sequences) {
  const list = Array.isArray(slices) ? slices : [];
  if (spec.kind === 'map') {
    const out = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? { ...legacy } : {};
    for (const slice of list) {
      if (!slice.accountId) continue;
      out[slice.accountId] = slice.value;
    }
    return out;
  }
  if (spec.kind === 'array') {
    const replaced = new Set(list.map((slice) => slice.accountId));
    const rows = [];
    for (const row of Array.isArray(legacy) ? legacy : []) {
      if (replaced.has(ownerIdOf(row, spec.owner))) continue;
      rows.push(row);
    }
    for (const slice of list) {
      if (Array.isArray(slice.value)) rows.push(...slice.value);
    }
    return rows;
  }
  const seq = Array.isArray(sequences)
    ? sequences
    : (Array.isArray(legacy?.sequences) ? legacy.sequences : []);
  const replaced = new Set(list.map((slice) => slice.accountId));
  const enrollments = [];
  for (const row of Array.isArray(legacy?.enrollments) ? legacy.enrollments : []) {
    if (replaced.has(ownerIdOf(row, 'userId'))) continue;
    enrollments.push(row);
  }
  for (const slice of list) {
    if (Array.isArray(slice.value)) enrollments.push(...slice.value);
  }
  return { sequences: seq, enrollments };
}

export function collectionHasRows(spec, data) {
  if (spec.kind === 'array') return Array.isArray(data) && data.length > 0;
  if (spec.kind === 'map') {
    return Boolean(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0);
  }
  return Boolean((data?.sequences || []).length || (data?.enrollments || []).length);
}

/** A local file wins only when it is newer than the newest hub document for that collection. */
export function localCopyWins({ localMs, mirroredMs, hubMs, localHasRows, hubHasDocs }) {
  if (!localHasRows) return false;
  if (!hubHasDocs) return true;
  if (mirroredMs && localMs <= mirroredMs) return false;
  if (!localMs) return false;
  return localMs > hubMs;
}

export function sliceOf(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  if (document._jourvanceSequences === true) return { sequences: document.value };
  if (typeof document._jourvanceAccount === 'string' && Object.prototype.hasOwnProperty.call(document, 'value')) {
    return { accountId: document._jourvanceAccount, value: document.value };
  }
  return null;
}

export function wrapSlice(accountId, value) {
  return { _jourvanceAccount: accountId, value };
}

export function wrapSequences(sequences) {
  return { _jourvanceSequences: true, value: Array.isArray(sequences) ? sequences : [] };
}

/** Read every name. batchGet allows 50 names and 16 MB; 20 keeps one answer smaller. */
export async function batchGetAll(docsApi, names, size = BATCH_SIZE) {
  const out = [];
  const list = Array.isArray(names) ? names : [];
  for (let i = 0; i < list.length; i += size) {
    const slice = list.slice(i, i + size);
    const got = await docsApi.batchGet(slice);
    if (!got || got.error || !Array.isArray(got.documents)) {
      const err = new Error(got?.error || 'Document batch was not read.');
      err.partial = out;
      throw err;
    }
    out.push(...got.documents);
  }
  return out;
}

function timeMs(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

function emptyValue(spec) {
  if (spec.kind === 'array') return [];
  if (spec.kind === 'map') return {};
  return { sequences: [], enrollments: [] };
}

export class HubStorageManager {
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
    this.sliceIds = new Map();
  }

  init({ hub, hubReady, dataDir }) {
    this.hub = hub;
    this.hubReady = Boolean(hubReady && hub?.store?.docs);
    this.dataDir = dataDir || process.cwd();

    if (!this.behaviorFlushTimer) {
      this.behaviorFlushTimer = setInterval(() => {
        this.flushDirtyBehavior().catch((err) => {
          console.warn('[Jourvance Storage] Periodic behavior flush warning:', err.message);
        });
      }, 5000);
      if (this.behaviorFlushTimer.unref) this.behaviorFlushTimer.unref();
    }

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
      if (!fs.existsSync(file)) return fallback !== null ? fallback : [];
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

  fileMtimeMs(filename) {
    try {
      return fs.statSync(this.filePath(filename)).mtimeMs;
    } catch {
      return 0;
    }
  }

  readSyncMeta() {
    const data = this.readLocalJson(SYNC_FILE, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  writeSyncMeta(meta) {
    this.writeLocalJson(SYNC_FILE, meta);
  }

  noteMirrored(filename) {
    const meta = this.readSyncMeta();
    meta[filename] = { mirroredAtMs: this.fileMtimeMs(filename) };
    this.writeSyncMeta(meta);
  }

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

    if (options.immediateDisk) {
      this.writeLocalJson(filename, data);
    } else {
      this.scheduleDiskWrite(filename, data);
    }

    if (!this.hubReady) return;
    const spec = TENANT_SPECS[docKey];
    if (spec) {
      this.scheduleTenantPuts(spec, docKey, data);
      return;
    }
    this.scheduleHubPut(docKey, data, options.debounceMs || 1000);
  }

  scheduleTenantPuts(spec, docKey, data) {
    const { parts, sequences } = partitionTenant(spec, data);
    const next = new Set();
    if (spec.kind === 'drips') {
      next.add('sequences');
      this.scheduleHubPut(sequencesDocName(docKey), wrapSequences(sequences));
    }
    for (const [id, value] of parts) {
      next.add(`account:${id}`);
      this.scheduleHubPut(accountDocName(docKey, id), wrapSlice(id, value));
    }
    const previous = this.sliceIds.get(docKey) || new Set();
    for (const id of previous) {
      if (next.has(id)) continue;
      const name = id === 'sequences'
        ? sequencesDocName(docKey)
        : accountDocName(docKey, id.slice('account:'.length));
      this.scheduleHubPut(name, null);
    }
    this.sliceIds.set(docKey, next);
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
      if (latestData === null) {
        await this.removeDoc(docKey);
        return;
      }
      await this.putDoc(docKey, latestData);
    }, debounceMs);
    if (timer.unref) timer.unref();
    this.flushTimers.set(timerKey, timer);
  }

  async putDoc(name, document) {
    try {
      const res = await this.hub.store.docs.put(name, document, { sourceUpdatedAt: new Date().toISOString() });
      if (res?.error) {
        console.warn(`[Jourvance Storage] Failed remote put for ${name}:`, res.error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[Jourvance Storage] Failed remote put for ${name}:`, err.message);
      return false;
    }
  }

  async removeDoc(name) {
    if (typeof this.hub?.store?.docs?.remove !== 'function') return false;
    try {
      const res = await this.hub.store.docs.remove(name);
      if (res?.error) {
        console.warn(`[Jourvance Storage] Failed remote remove for ${name}:`, res.error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[Jourvance Storage] Failed remote remove for ${name}:`, err.message);
      return false;
    }
  }

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
    const uids = [...this.behaviorDirtyUids];
    this.behaviorDirtyUids.clear();
    const all = this.get('store.behavior', 'behavior.json', {});
    this.writeLocalJson('behavior.json', all);
    if (!this.hubReady) return;
    for (const uid of uids) {
      const value = all[uid] || { events: [], subscriptions: [] };
      const ok = await this.putDoc(accountDocName('store.behavior', uid), wrapSlice(uid, value));
      if (!ok) this.behaviorDirtyUids.add(uid);
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

  async readNamed(names) {
    if (!names.length) return [];
    try {
      return await batchGetAll(this.hub.store.docs, names, BATCH_SIZE);
    } catch (err) {
      console.warn('[Jourvance Storage] Batch read failed, reading one by one:', err.message);
      const out = [];
      for (const name of names) {
        try {
          const one = await this.hub.store.docs.get(name);
          if (one && !one.error && one.document !== undefined) {
            out.push({ name, found: true, document: one.document, updatedAt: one.updatedAt });
          }
        } catch {
          // This name stays where it was. A later boot can read it.
        }
      }
      return out;
    }
  }

  relatedNames(collectionKey, listed) {
    const prefix = `${collectionKey}.`;
    const names = [];
    for (const entry of listed) {
      const name = entry?.name;
      if (!name) continue;
      if (name === collectionKey || name.startsWith(prefix)) names.push(entry);
    }
    return names;
  }

  async rehydrateCollection(spec, docKey, listed, meta) {
    const fallback = emptyValue(spec);
    const localData = this.readLocalJson(spec.file, fallback);
    const localMs = this.fileMtimeMs(spec.file);
    const related = this.relatedNames(docKey, listed);
    const hubMs = related.reduce((max, entry) => {
      if (!entry.updatedAt) return Number.POSITIVE_INFINITY;
      return Math.max(max, timeMs(entry.updatedAt));
    }, 0);
    const mirroredMs = Number(meta[spec.file]?.mirroredAtMs) || 0;
    const localHasRows = collectionHasRows(spec, localData);
    const useLocal = localCopyWins({
      localMs,
      mirroredMs,
      hubMs: Number.isFinite(hubMs) ? hubMs : Number.POSITIVE_INFINITY,
      localHasRows,
      hubHasDocs: related.length > 0
    });

    if (useLocal) {
      const ok = await this.pushCollection(spec, docKey, localData, related.map((entry) => entry.name));
      this.memoryCache.set(docKey, localData);
      if (ok) this.noteMirrored(spec.file);
      return { source: 'local', ok };
    }

    if (!related.length) {
      this.memoryCache.set(docKey, localHasRows ? localData : fallback);
      return { source: 'empty', ok: true };
    }

    const docs = await this.readNamed(related.map((entry) => entry.name));
    const combined = this.combineListed(spec, docKey, docs);
    this.memoryCache.set(docKey, combined.value);
    this.rememberIds(docKey, spec, combined.value);
    this.writeLocalJson(spec.file, combined.value);
    this.noteMirrored(spec.file);
    if (combined.legacyName) {
      const seeded = await this.pushMissingFromLegacy(spec, docKey, combined);
      if (seeded) await this.removeDoc(combined.legacyName);
    }
    return { source: 'hub', ok: true };
  }

  combineListed(spec, docKey, docs) {
    let legacy = null;
    let legacyName = '';
    let sequences = null;
    let hadSequences = false;
    const slices = [];
    for (const item of docs) {
      if (!item || item.found === false || item.document === undefined) continue;
      const body = item.document;
      const parsed = sliceOf(body);
      if (item.name === sequencesDocName(docKey) || parsed?.sequences) {
        sequences = parsed?.sequences ?? body;
        hadSequences = true;
        continue;
      }
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'accountId')) {
        slices.push({ accountId: parsed.accountId, value: parsed.value });
        continue;
      }
      if (item.name === docKey) {
        legacy = body;
        legacyName = item.name;
      }
    }
    return { value: combineTenant(spec, legacy, slices, sequences), legacyName, slices, hadSequences };
  }

  async pushMissingFromLegacy(spec, docKey, combined) {
    if (!combined.legacyName) return true;
    const { parts, sequences } = partitionTenant(spec, combined.value);
    const have = new Set(combined.slices.map((slice) => slice.accountId));
    let ok = true;
    if (spec.kind === 'drips' && !combined.hadSequences) {
      if (!await this.putDoc(sequencesDocName(docKey), wrapSequences(sequences))) ok = false;
    }
    for (const [id, value] of parts) {
      if (have.has(id)) continue;
      if (!await this.putDoc(accountDocName(docKey, id), wrapSlice(id, value))) ok = false;
    }
    return ok;
  }

  async pushCollection(spec, docKey, data, existingNames) {
    const { parts, sequences } = partitionTenant(spec, data);
    const names = new Set();
    let ok = true;
    if (spec.kind === 'drips') {
      const name = sequencesDocName(docKey);
      names.add(name);
      if (!await this.putDoc(name, wrapSequences(sequences))) ok = false;
    }
    for (const [id, value] of parts) {
      const name = accountDocName(docKey, id);
      names.add(name);
      if (!await this.putDoc(name, wrapSlice(id, value))) ok = false;
    }
    if (!ok) return false;
    for (const name of existingNames) {
      if (!names.has(name)) await this.removeDoc(name);
    }
    this.rememberIds(docKey, spec, data);
    return true;
  }

  rememberIds(docKey, spec, data) {
    const { parts } = partitionTenant(spec, data);
    const ids = new Set();
    if (spec.kind === 'drips') ids.add('sequences');
    for (const id of parts.keys()) ids.add(`account:${id}`);
    this.sliceIds.set(docKey, ids);
  }

  async rehydrateAll({
    workspaceCache,
    publicPageCache,
    sanitizeWorkspace,
    persistWorkspaces,
    persistPublicPages
  }) {
    if (!this.hubReady) {
      console.log('[Jourvance Storage] Operating in local fallback mode (HUB_API_KEY unset).');
      return { success: true, mode: 'local' };
    }

    console.log('[Jourvance Storage] Starting Hub Firestore rehydration and sync...');
    const meta = this.readSyncMeta();
    let listed = [];
    let listOk = false;
    try {
      const list = await this.hub.store.docs.list();
      if (list && !list.error && Array.isArray(list.documents)) {
        listed = list.documents;
        listOk = true;
      }
    } catch (err) {
      console.warn('[Jourvance Storage] Document list was not read:', err.message);
    }

    let fromHub = 0;
    let fromLocal = 0;
    if (listOk) {
      for (const [docKey, spec] of Object.entries(TENANT_SPECS)) {
        try {
          const result = await this.rehydrateCollection(spec, docKey, listed, meta);
          if (result.source === 'hub') fromHub += 1;
          if (result.source === 'local') fromLocal += 1;
        } catch (err) {
          const fallback = this.readLocalJson(spec.file, emptyValue(spec));
          this.memoryCache.set(docKey, fallback);
          console.warn(`[Jourvance Storage] Kept local ${spec.file}:`, err.message);
        }
      }
      await this.rehydrateWorkspaces(listed, workspaceCache, sanitizeWorkspace, persistWorkspaces);
      await this.rehydratePages(listed, publicPageCache, persistPublicPages);
    } else {
      for (const [docKey, spec] of Object.entries(TENANT_SPECS)) {
        this.memoryCache.set(docKey, this.readLocalJson(spec.file, emptyValue(spec)));
      }
    }

    console.log(`[Jourvance Storage] Rehydration complete: ${fromHub} stores loaded from Hub, ${fromLocal} kept from the newer local file.`);
    return { success: true, rehydratedCount: fromHub, migratedCount: fromLocal };
  }

  async rehydrateWorkspaces(listed, workspaceCache, sanitizeWorkspace, persistWorkspaces) {
    if (!workspaceCache) return;
    const names = listed.map((entry) => entry.name).filter((name) => name && name.startsWith('workspace.'));
    const docs = names.length ? await this.readNamed(names) : [];
    const seen = new Set();
    let changed = false;
    for (const item of docs) {
      const ws = item?.document;
      if (!ws?.userId || !ws?.id) continue;
      const key = `${ws.userId}:${ws.id}`;
      seen.add(key);
      const sanitized = sanitizeWorkspace ? sanitizeWorkspace(ws) : ws;
      const local = workspaceCache[key];
      if (local && String(local.updatedAt || '') > String(sanitized?.updatedAt || '')) {
        await this.putDoc(workspaceDocName(local.userId, local.id), local);
        continue;
      }
      workspaceCache[key] = sanitized;
      changed = true;
    }
    for (const ws of Object.values(workspaceCache)) {
      if (!ws?.id || !ws?.userId) continue;
      const key = `${ws.userId}:${ws.id}`;
      if (seen.has(key)) continue;
      await this.putDoc(workspaceDocName(ws.userId, ws.id), ws);
    }
    if (changed && persistWorkspaces) persistWorkspaces();
  }

  async rehydratePages(listed, publicPageCache, persistPublicPages) {
    if (!publicPageCache) return;
    const names = listed.map((entry) => entry.name).filter((name) => name && name.startsWith('pubpage.'));
    const docs = names.length ? await this.readNamed(names) : [];
    const seen = new Set();
    let changed = false;
    for (const item of docs) {
      const page = item?.document;
      if (!page?.slug) continue;
      seen.add(pageDocName(page.slug));
      const local = publicPageCache[page.slug];
      if (local && typeof local === 'object' && String(local.updatedAt || '') > String(page.updatedAt || '')) {
        await this.putDoc(pageDocName(page.slug), local);
        continue;
      }
      publicPageCache[page.slug] = page;
      changed = true;
    }
    for (const page of Object.values(publicPageCache)) {
      if (!page || typeof page !== 'object' || !page.slug) continue;
      const name = pageDocName(page.slug);
      if (seen.has(name)) continue;
      await this.putDoc(name, page);
    }
    if (changed && persistPublicPages) persistPublicPages();
  }
}

export const hubStorage = new HubStorageManager();
export default hubStorage;
