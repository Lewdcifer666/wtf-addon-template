// Code-owned generic public vocabulary. No quote, rating, watched identity,
// arbitrary caller text or unknown preference name can become a provider query.
import {LearningError} from './git-artifacts.mjs';
const genres={action:'action film television',anime:'anime film television',fantasy:'fantasy film television',mystery:'mystery film television',scifi:'science fiction film television',thriller:'thriller film television'};
const words={mystery:'mystery',mystery_density:'mystery',scientific_investigation:'scientific investigation',biology_genetics:'biology genetics',science_biology:'biology',alien_unknown:'extraterrestrial',alien_unknown_life:'extraterrestrial',unknown_phenomenon:'unexplained phenomenon',rule_discovery:'world rules',world_rules:'world rules',concept_escalation:'speculative concepts',weirdness:'surreal',reality_anomaly:'alternate reality',time_anomaly:'time travel',reality_time_anomaly:'alternate reality',mind_consciousness:'consciousness',experiments:'scientific experiments',conspiracy:'conspiracy',creature_threat:'creature',scientist_presence:'scientists',research_setting:'research',isolation:'isolation',suspense:'suspense',horror:'horror',action:'action',humor:'comedy',survival_chase:'survival',military_focus:'military'};
export function dailySearchPolicy(context){
 if(!context||!Object.hasOwn(genres,context.genre)||!Array.isArray(context.preferences))throw new LearningError('invalid_search_request');
 const indexes=[],terms=[];
 for(const [index,p]of context.preferences.entries()){
  if(indexes.length>=2)break;
  if(!['content','tone'].includes(p?.category)||p.direction!=='seek_support'||p.conflict!==false||!Object.hasOwn(words,p.aspect)||terms.includes(words[p.aspect]))continue;
  indexes.push(index);terms.push(words[p.aspect]);
 }
 return {schema_version:1,request_id:'daily-primary',maximum_searches:1,query:[genres[context.genre],...terms].join(' '),preference_indexes:indexes};
}
export function assertDailySearchRequest(request,policy){
 if(request.request_id!==policy.request_id)throw new LearningError('daily_search_limit');
 if(request.query!==policy.query||JSON.stringify(request.preference_indexes)!==JSON.stringify(policy.preference_indexes))throw new LearningError('invalid_search_request');
}
