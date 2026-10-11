// Pure graph resolver preserved from the audited Sci-Fi implementation.
// Resolve the COMPLETE graph before identity, genre or retraction filtering.
const SUPPORTED = new Set([1, 2, 3]);
const CONTEXTS = new Set(['scifi', 'fantasy', 'action', 'anime', 'thriller', null]);
const goodId = x => typeof x === 'string' && /^tt\d+$/.test(x);
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
function identity(e){ return goodId(e?.imdb_id)?`imdb:${e.imdb_id}`:typeof e?.source_id==="string"&&e.source_id?`source:${e.source_id}`:null; }
function when(x){ return Date.parse(x); }

// Rebuilding must never turn a partial or malformed feedback history into a
// fresh-looking snapshot. These are the common fields used by this resolver;
// extra schema-owned fields remain inert. Unsupported schemas fail the entire
// rebuild, so an opaque correction can never resurrect its older opinion.
function validateFeedback(events) {
  if (!Array.isArray(events)) throw new Error("feedback snapshot must be an array");
  const byId = new Map();
  for (const e of events) {
    if (!obj(e) || !SUPPORTED.has(e.schema_version)) throw new Error("unsupported or missing feedback schema_version");
    if (typeof e.feedback_id !== "string" || !e.feedback_id.trim()) throw new Error("feedback_id must be a nonempty string");
    if (byId.has(e.feedback_id)) throw new Error("duplicate feedback_id");
    if (e.supersedes != null && (typeof e.supersedes !== "string" || !e.supersedes.trim())) throw new Error("supersedes must be a feedback_id or null");
    if (e.imdb_id !== null && !goodId(e.imdb_id)) throw new Error("imdb_id must be a valid IMDb id or null");
    if (e.source_id != null && (typeof e.source_id !== "string" || !e.source_id.trim())) throw new Error("source_id must be a nonempty string or null");
    if (typeof e.status !== "string" || !e.status.trim()) throw new Error("feedback status must be a nonempty string");
    if (typeof e.rated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(e.rated_at)
      || !Number.isFinite(when(e.rated_at))
      || new Date(when(e.rated_at)).toISOString().slice(0, 19) !== e.rated_at.slice(0, 19)) throw new Error("rated_at must be a valid UTC timestamp");
    if (e.rating != null && (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5)) throw new Error("rating must be an integer from 1 to 5 or null");
    if (e.schema_version === 3 && !CONTEXTS.has(e.profile_context)) throw new Error("unsupported or missing schema-3 profile_context");
    for (const side of ["liked", "disliked"]) {
      if (e[side] != null && (!Array.isArray(e[side]) || e[side].some(x => typeof x !== "string" || !x.trim()))) throw new Error(`${side} must be an array of aspect names`);
    }
    const interest = e.schema_version === 1 ? e.more_like_this : e.premise_interest;
    if (interest != null && !["yes", "no", "maybe"].includes(interest)) throw new Error("unsupported feedback interest value");
    byId.set(e.feedback_id, e);
  }
  for (const e of byId.values()) {
    if (e.supersedes != null && !byId.has(e.supersedes)) throw new Error("incomplete feedback history: superseded event is missing");
  }
  const complete = new Set();
  for (const start of byId.keys()) {
    const chain = new Set();
    let id = start;
    while (id != null && !complete.has(id)) {
      if (chain.has(id)) throw new Error("invalid feedback history: supersedes cycle");
      chain.add(id);
      id = byId.get(id).supersedes ?? null;
    }
    for (const id of chain) complete.add(id);
  }
  return byId;
}

export function resolveFeedback(events){
  const byId=validateFeedback(events);
  const superseded=new Set([...byId.values()].map(e=>e.supersedes).filter(x=>typeof x==="string"&&x));
  const out=new Map(), loose=[];
  for(const e of byId.values()){
    if(superseded.has(e.feedback_id)) continue;
    const k=identity(e); if(!k){loose.push(e);continue;}
    const p=out.get(k); if(!p||when(e.rated_at)>when(p.rated_at)||(when(e.rated_at)===when(p.rated_at)&&e.feedback_id>p.feedback_id)) out.set(k,e);
  }
  return [...out.values(),...loose].sort((a, b) => a.feedback_id < b.feedback_id ? -1 : a.feedback_id > b.feedback_id ? 1 : 0);
}
