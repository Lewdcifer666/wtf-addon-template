// Frozen audited Sci-Fi structured resolver/aggregation, used only with synthetic fixtures.
const SUPPORTED = new Set([1, 2, 3]);
const CONTEXTS = new Set(["scifi", "fantasy", "action", "anime", "thriller", null]);
const IMDB = /^tt\d+$/;
const EXEC = new Set(["acting","characters","dialogue","pacing","visuals","effects","ending_payoff","sound_music","originality"]);
const TONE = new Map([["suspense","suspense"],["horror","horror"],["action","action_intensity"],["humor","comedy"],["survival_chase","survival_chase"],["military_focus","military_focus"]]);
const CONCEPT = new Map([
  ["mystery",["mystery"]],["science_biology",["biology_genetics"]],["alien_unknown",["alien_unknown_life","unknown_phenomenon"]],
  ["scientific_investigation",["scientific_investigation"]],["world_rules",["rule_discovery"]],["concept_escalation",["concept_escalation"]],
  ["weirdness",["weirdness"]],["reality_time_anomaly",["reality_anomaly","time_anomaly"]],["mind_consciousness",["mind_consciousness"]],
  ["experiments",["experiments"]],["conspiracy",["conspiracy"]],["creature_threat",["creature_threat"]]
]);
const UNIVERSAL_V3 = new Set(["mystery","world_rules","conspiracy","creature_threat","concept_escalation","weirdness"]);
const PROJECTABLE = ["scientific_investigation","biology_genetics","alien_unknown_life","unknown_phenomenon","mystery","rule_discovery","concept_escalation","weirdness","reality_anomaly","time_anomaly","mind_consciousness","experiments","conspiracy","scientist_presence","research_setting","isolation","creature_threat"];
const LEGACY = { liked:{biology:"science_biology",rule_discovery:"world_rules",impossible_system:"world_rules",fast_pacing:"pacing",great_payoff:"ending_payoff",time_reality:"reality_time_anomaly"}, disliked:{too_slow:"pacing",boring_middle:"pacing",too_much_action:"action",too_much_horror:"horror",psychological_horror:"horror",weak_payoff:"ending_payoff",monster_chase:"survival_chase",weak_characters:"characters"} };
const KNOWN = new Set([...EXEC,...TONE.keys(),...CONCEPT.keys(),"premise_concept","setting_atmosphere","emotion"]);
const clamp=(v,a,b)=>Math.min(Math.max(v,a),b), tier=n=>n<1?0:n===1?.3:n===2?.6:1, shift=n=>n<1?0:n===1?6:n===2?12:20;
const goodId=x=>typeof x==="string"&&IMDB.test(x), obj=x=>x&&typeof x==="object"&&!Array.isArray(x);

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

function add(store,key,title,val){ if(!val) return; if(!store.has(key)) store.set(key,new Map()); const m=store.get(key); m.set(title,clamp((m.get(title)||0)+val,-1,1)); }
function summarize(store){ const out=new Map(); for(const [k,m] of store){ const v=[...m.values()]; if(v.length) out.set(k,(v.reduce((a,b)=>a+b,0)/v.length)*tier(v.length)); } return out; }
function aspect(raw,side,v){ if(v!==1) return KNOWN.has(raw)?raw:null; return KNOWN.has(raw)?raw:(LEGACY[side][raw]||null); }
function supported(e){ return SUPPORTED.has(e.schema_version) && (e.schema_version!==3||CONTEXTS.has(e.profile_context)); }

export function deriveSignals({tips,publicItems}){
  const byImdb=new Map(publicItems.filter(x=>goodId(x.imdb_id)).map(x=>[x.imdb_id,x])), owned=new Set(byImdb.keys());
  const cv=new Map(), ev=new Map(), tv=new Map(), ratings=[], cTitles=new Set(), eTitles=new Set(); let unsupported=0, nonOwned=0;
  for(const e of tips){
    if(!supported(e)){unsupported++;continue;} if(e.status==="retracted"||!goodId(e.imdb_id)) continue;
    const own=owned.has(e.imdb_id), title=`imdb:${e.imdb_id}`, src=byImdb.get(e.imdb_id), v3=e.schema_version===3;
    if(!own) nonOwned++;
    const scoped=v3?(e.profile_context==="scifi"||(e.profile_context===null&&own)):own;
    if(scoped&&Number.isInteger(e.rating)&&e.rating>=1&&e.rating<=5) ratings.push(e.rating);
    if(scoped&&own&&src?.dna){
      const p=e.schema_version===1?e.more_like_this:e.premise_interest, mag=e.schema_version===1?.5:1, sign=p==="yes"?1:p==="no"?-1:0;
      if(sign) for(const d of PROJECTABLE) if(Number.isInteger(src.dna[d])&&src.dna[d]>=7){add(cv,d,title,sign*mag);cTitles.add(title);}
    }
    for(const [side,list,sign] of [["liked",e.liked,1],["disliked",e.disliked,-1]]) for(const raw of Array.isArray(list)?list:[]){
      const a=typeof raw==="string"?aspect(raw,side,e.schema_version):null; if(!a) continue;
      if(EXEC.has(a)){ if(scoped||v3){add(ev,a,title,sign);eTitles.add(title);} continue; }
      if(TONE.has(a)){ if(scoped){add(tv,a,title,sign*.3);eTitles.add(title);} continue; }
      const allowed=scoped||(v3&&UNIVERSAL_V3.has(a)); if(!allowed) continue;
      if(a==="premise_concept"){ if(src?.dna) for(const d of PROJECTABLE) if(Number.isInteger(src.dna[d])&&src.dna[d]>=7){add(cv,d,title,sign*.6);cTitles.add(title);} continue; }
      let dims=CONCEPT.get(a)||[]; if(dims.length>1) dims=src?.dna?dims.filter(d=>Number.isInteger(src.dna[d])&&src.dna[d]>=5):[];
      for(const d of dims){add(cv,d,title,sign*.6);cTitles.add(title);}
    }
  }
  return {contentPreferences:summarize(cv),executionPreferences:summarize(ev),tonePreferences:summarize(tv),ratings,contentEvidenceTitles:cTitles.size,executionEvidenceTitles:eTitles.size,unsupportedTips:unsupported,nonOwnedTips:nonOwned};
}
