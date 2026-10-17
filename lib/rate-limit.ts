// Small in-memory sliding-window limiter for one Next process. It complements
// (never replaces) the database and Auth limits, which survive restarts.
const buckets = new Map<string, Map<string, { count: number; expires: number }>>();

export function allowRequest(bucket: string, key: string, limit: number, windowMs: number, now = Date.now()) {
  let entries = buckets.get(bucket);
  if (!entries) { entries = new Map(); buckets.set(bucket, entries); }
  for (const [id, item] of entries) if (item.expires <= now) entries.delete(id);
  if (!entries.has(key) && entries.size >= 5000) return false;
  const item = entries.get(key) || { count: 0, expires: now + windowMs };
  entries.set(key, item);
  return ++item.count <= limit;
}
