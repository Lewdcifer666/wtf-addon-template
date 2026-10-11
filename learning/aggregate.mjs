import {ASPECTS,canonicalAspect} from './interpretation.mjs';

const clamp=(v,a,b)=>Math.min(Math.max(v,a),b);
const tier=n=>n<1?0:n===1?.3:n===2?.6:1;
const shift=n=>n<1?0:n===1?6:n===2?12:20;
const id=value=>typeof value==='string'&&/^tt\d+$/.test(value);
const sorted=map=>Object.fromEntries([...map].sort(([a],[b])=>a<b?-1:a>b?1:0));

export function validateAdapter(adapter,profile){
  if(adapter.schema_version!==1||!['scifi','fantasy','action','anime','thriller','mystery'].includes(adapter.genre))throw Error('Unsupported learning adapter');
  const dimensions=new Set(profile.dna_dimensions.dimensions.map(d=>d.id));
  const blocked=new Set(adapter.blocked_projection);
  for(const dimension of [...adapter.projectable,...Object.values(adapter.concept_dimensions).flat(),...Object.values(adapter.tone_dimensions)]){
    if(!dimensions.has(dimension)||blocked.has(dimension))throw Error('Adapter references unknown or non-projectable dimension');
  }
  if(new Set(adapter.projectable).size!==adapter.projectable.length)throw Error('Repeated projection dimension');
  for(const aspect of Object.keys(adapter.concept_dimensions))if(!ASPECTS.concept.includes(aspect)||aspect==='premise_concept')throw Error('Unknown concept mapping');
  for(const aspect of Object.keys(adapter.tone_dimensions))if(!ASPECTS.tone.includes(aspect))throw Error('Unknown tone mapping');
  if(adapter.genre!=='scifi'&&(!adapter.owned_imdb_required||adapter.universal_v3_execution||adapter.universal_v3_concepts.length))throw Error('Owned-IMDb boundary required');
  if(profile.execution_preferences.content_vs_execution.content_fit!==.7||profile.execution_preferences.content_vs_execution.execution_fit!==.3
    ||JSON.stringify(profile.execution_preferences.evidence_ladder)!==JSON.stringify({weak:1,emerging:2,meaningful:3}))throw Error('Learning policy changed; explicit adapter migration required');
  if(adapter.genre==='mystery'&&['mystery_density','revelation_frequency','progressive_revelation'].some(d=>!blocked.has(d)))throw Error('Missing Mystery safeguard');
  return adapter;
}

// A normalized row retains the original event plus separately capped inferred
// aspects. All graph resolution must already have happened globally.
export function aggregateLearning({normalized,publicItems,adapter}){
  const byImdb=new Map();
  for(const item of publicItems.filter(item=>id(item.imdb_id))){
    if(byImdb.has(item.imdb_id))throw Error('Ambiguous owned public identity');
    byImdb.set(item.imdb_id,item);
  }
  const stores={content:new Map(),execution:new Map(),tone:new Map()},lineage=[],ratings=[],contentTitles=new Set(),executionTitles=new Set();
  const strengths={content:new Map(),execution:new Map()};
  const add=(kind,key,event,value,source)=>{
    if(!value)return;
    const store=stores[kind];if(!store.has(key))store.set(key,new Map());
    const values=store.get(key),title=event.imdb_id;
    values.set(title,clamp((values.get(title)||0)+value,-1,1));
    (kind==='content'?contentTitles:executionTitles).add(title);
    const group=kind==='content'?'content':'execution',strength=source==='interpreted_free_text'?.3:1;
    strengths[group].set(title,Math.max(strengths[group].get(title)||0,strength));
    lineage.push({feedback_id:event.feedback_id,imdb_id:title,category:kind,aspect:key,contribution:value,source});
  };
  for(const {event:e,lineage:inferred=[]} of normalized){
    if(e.status==='retracted'||!id(e.imdb_id))continue;
    const src=byImdb.get(e.imdb_id),own=!!src,v3=e.schema_version===3;
    if(adapter.owned_imdb_required&&!own)continue;
    const scoped=v3?(e.profile_context===adapter.genre||(e.profile_context===null&&own)):own;
    if(scoped&&Number.isInteger(e.rating))ratings.push(e.rating);
    const project=(sign,scale,source)=>{
      if(!src?.dna)return;
      for(const d of adapter.projectable)if(Number.isInteger(src.dna[d])&&src.dna[d]>=7)add('content',d,e,sign*scale,source);
    };
    if(scoped&&own){
      const p=e.schema_version===1?e.more_like_this:e.premise_interest;
      if(p==='yes'||p==='no')project(p==='yes'?1:-1,e.schema_version===1?.5:1,'structured_premise');
    }
    const apply=(aspect,sign,scale,source)=>{
      if(ASPECTS.execution.includes(aspect)){
        if(scoped||(v3&&(adapter.universal_v3_execution||own)))add('execution',aspect,e,sign*scale,source);
        return;
      }
      if(ASPECTS.tone.includes(aspect)){
        if(scoped&&adapter.tone_dimensions[aspect])add('tone',aspect,e,sign*.3*scale,source);
        return;
      }
      if(!scoped&&!(v3&&adapter.universal_v3_concepts.includes(aspect)))return;
      if(aspect==='premise_concept'){project(sign,.6*scale,source);return;}
      let dims=adapter.concept_dimensions[aspect]||[];
      if(dims.length>1||adapter.source_dna_required_concepts.includes(aspect))dims=dims.filter(d=>Number.isInteger(src?.dna?.[d])&&src.dna[d]>=5);
      for(const d of dims)add('content',d,e,sign*.6*scale,source);
    };
    const occupied=new Set();
    for(const side of ['liked','disliked'])for(const raw of e[side]||[]){
      const aspect=canonicalAspect(raw,side,e.schema_version);if(!aspect)continue;
      // Count repeated/aliased chips only once per side. Opposite explicit
      // answers cancel, rather than letting inference resolve the conflict.
      const key=`${side}:${aspect}`;if(occupied.has(key))continue;occupied.add(key);
      apply(aspect,side==='liked'?1:-1,1,'structured_aspect');
    }
    for(const item of inferred){
      if(occupied.has(`liked:${item.aspect}`)||occupied.has(`disliked:${item.aspect}`))continue;
      if(item.source!=='interpreted_free_text'||item.maximum_magnitude!==.3)throw Error('Unvalidated inferred strength');
      occupied.add(`${item.side}:${item.aspect}`);
      apply(item.aspect,item.side==='liked'?1:-1,.3,'interpreted_free_text');
    }
  }
  const summarize=store=>{
    const values=new Map(),evidence=new Map();
    for(const [aspect,titles] of store){const contributions=[...titles.values()];
      values.set(aspect,contributions.reduce((a,b)=>a+b,0)/contributions.length*tier(contributions.length));
      evidence.set(aspect,{titles:contributions.length,positive:contributions.filter(v=>v>0).length,negative:contributions.filter(v=>v<0).length});
    }
    return {values:sorted(values),evidence:sorted(evidence)};
  };
  return {schema_version:1,genre:adapter.genre,content:summarize(stores.content),execution:summarize(stores.execution),tone:summarize(stores.tone),
    ratings:[...ratings].sort((a,b)=>a-b),content_evidence_titles:contentTitles.size,execution_evidence_titles:executionTitles.size,
    adjustment_strength:Object.fromEntries(Object.entries(strengths).map(([kind,m])=>[kind,m.size?[...m.values()].reduce((a,b)=>a+b,0)/m.size:0])),
    lineage:lineage.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
}

// Private numerical diagnostics, never a publication scorer or eligibility
// override. Unknown DNA contributes nothing, and is never replaced with zero.
export function learningAdjustments({item,signals,profile,adapter,executionEvidence={}}){
  let raw=0,norm=0,applied=0;
  for(const [d,p] of Object.entries(signals.content.values)){
    const w=profile.dna_baseline.weights[d],v=item.dna?.[d];
    if(typeof w!=='number'||!p||!Number.isInteger(v))continue;
    const importance=w===0?5:Math.abs(w);raw+=p*importance*v/10;norm+=Math.abs(p)*importance;if(v)applied++;
  }
  const content=norm&&applied?shift(signals.content_evidence_titles)*signals.adjustment_strength.content*raw/norm:null;
  raw=0;norm=0;
  for(const [aspect,p] of Object.entries(signals.execution.values)){
    const value=executionEvidence[item.imdb_id]?.[aspect];if((value===1||value===-1)&&p){raw+=p*value;norm+=Math.abs(p);}
  }
  for(const [aspect,p] of Object.entries(signals.tone.values)){
    const value=item.dna?.[adapter.tone_dimensions[aspect]];
    if(p&&Number.isInteger(value)&&value){raw+=p*value/10;norm+=Math.abs(p);}
  }
  return {content_adjustment:content,execution_adjustment:norm?shift(signals.execution_evidence_titles)*signals.adjustment_strength.execution*raw/norm:null};
}

export function researchContext(signals,adapter){
  const preferences=[];
  for(const category of ['content','execution','tone'])for(const [aspect,value] of Object.entries(signals[category].values)){
    const evidence=signals[category].evidence[aspect];
    if(!value)continue;
    // One negative example is diagnostic, not a generalized aversion. It
    // remains in private lineage/scores without becoming a search instruction.
    if(value<0&&evidence.titles<2)continue;
    preferences.push({category,aspect,direction:value>0?'seek_support':'deprioritize_softly',
      evidence_tier:evidence.titles<2?'weak':evidence.titles<3?'emerging':'meaningful',
      conflict:evidence.positive>0&&evidence.negative>0});
  }
  return {schema_version:1,genre:adapter.genre,adapter_version:adapter.schema_version,preferences,
    constraints:['Preserve public baseline thresholds, guardrails and research standards.',
      'Execution aspects require title-specific evidence; pacing is not a speed preference.',
      'These are soft private search priorities, never new exclusions or public explanations.']};
}
