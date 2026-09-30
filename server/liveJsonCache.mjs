/**
 * Reloads a JSON file into an object that other modules already hold.
 *
 * server.mjs hands its caches (domains.json, public_pages.json) to the route modules once, at
 * mount. A reload that reassigned the binding left every route reading the boot-time object, so a
 * custom domain verified after the server started published as unverified until a restart, and a
 * page published after a reload was written to an object the next persist no longer saved.
 * Replacing the contents keeps every captured reference live.
 *
 * An entry whose value reads the same as the file's keeps the object this process already holds.
 * Callers compare by identity: savePublicPage rolls back a page the store refused only while the
 * cache still holds the object it saved, and a reload landing during that await (an upsell action,
 * an order webhook, a visit to an unknown slug) must not turn "still mine" into "someone else's".
 *
 * A file that is missing, will not parse or is not a plain object leaves the cache as it was.
 */
import fs from 'fs';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

export function reloadJsonInPlace(target, filePath) {
  let fresh;
  try {
    if (!fs.existsSync(filePath)) return target;
    fresh = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return target;
  }
  if (!fresh || typeof fresh !== 'object' || Array.isArray(fresh)) return target;
  const next = Object.entries(fresh).map(([key, value]) => [
    key,
    hasOwn(target, key) && sameJson(target[key], value) ? target[key] : value
  ]);
  for (const key of Object.keys(target)) delete target[key];
  // defineProperty rather than Object.assign: a "__proto__" key in the file stays a key and
  // never becomes the cache's prototype.
  for (const [key, value] of next) {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return target;
}
