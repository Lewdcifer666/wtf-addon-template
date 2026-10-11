// Only trusted code calls this with a complete recursive Git tree and blobs
// fetched at its pinned commit. No filesystem paths or caller-selected subset.
import {digest, gitBlobOid, stableJson} from './interpretation.mjs';
import {resolveFeedback} from './resolve-feedback.mjs';

const oid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fail = message => { throw Error(`Feedback inventory rejected: ${message}`); };
function containsRawEvent(value) {
  if (Array.isArray(value)) return value.some(containsRawEvent);
  if (!value || typeof value !== 'object') return false;
  if (typeof value.feedback_id === 'string' && 'rated_at' in value && 'status' in value
    && ('imdb_id' in value || 'source_id' in value)) return true;
  return Object.values(value).some(containsRawEvent);
}
export function inventoryFeedback({commit, tree, blobs}) {
  if (!oid(commit?.sha) || !oid(commit?.tree?.sha) || tree?.sha !== commit.tree.sha
    || tree.truncated !== false || !Array.isArray(tree.tree)) fail('unproven or truncated tree');
  const records = [], seen = new Set();
  for (const entry of [...tree.tree].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const name = entry.path;
    if (typeof name !== 'string' || !name || /[\\\u0000-\u001f]/.test(name)
      || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) fail('unsafe or duplicate path');
    seen.add(name);
    const rawRoot = name === 'data/feedback' || name.startsWith('data/feedback/');
    if (entry.type === 'tree' && entry.mode === '040000') continue;
    if (entry.type !== 'blob' || !['100644','100755'].includes(entry.mode)) {
      // A symlink/submodule could hide omitted records anywhere in the source.
      fail('symlink, submodule or unsupported tree entry');
    }
    if (!name.toLowerCase().endsWith('.json')) {
      if (rawRoot && !name.endsWith('/.gitkeep')) fail('unexpected raw-root file');
      continue;
    }
    const bytes = blobs.get(entry.sha);
    if (!oid(entry.sha) || !Buffer.isBuffer(bytes) || bytes.length !== entry.size
      || gitBlobOid(bytes) !== entry.sha) fail('missing, changed or mis-sized blob');
    if (bytes.length > (rawRoot ? 256 * 1024 : 8 * 1024 * 1024)) fail('source JSON exceeds its limit');
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('malformed source JSON'); }
    if (!rawRoot) {
      if (containsRawEvent(value)) fail('raw events outside declared root');
      continue;
    }
    if (!/^data\/feedback\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/.test(name)
      || !value || Array.isArray(value) || typeof value !== 'object'
      || typeof value.feedback_id !== 'string' || /[\\/]/.test(value.feedback_id)
      || name !== `data/feedback/${String(value.rated_at).slice(0,10)}/${value.feedback_id}.json`) fail('raw path/identity disagreement');
    if (value.feedback != null && (typeof value.feedback !== 'string' || value.feedback.length > 20000)) fail('malformed free text');
    records.push({path:name, blob_oid:entry.sha, event:value});
  }
  const tips = resolveFeedback(records.map(record => record.event));
  const inventory = records.map(({path,blob_oid}) => ({path,blob_oid}));
  return {source_revision:commit.sha, inventory_hash:digest(stableJson(inventory)),
    event_count:records.length, records, tips};
}
