import {test} from 'node:test';import assert from 'node:assert/strict';
import {dailySearchPolicy,assertDailySearchRequest} from '../daily-search-policy.mjs';
test('daily generic query uses only fixed public words, never caller text or unknown private aspects',()=>{
 const policy=dailySearchPolicy({genre:'scifi',preferences:[{category:'content',aspect:'PRIVATE_SENTINEL',direction:'seek_support',conflict:false},{category:'execution',aspect:'acting',direction:'seek_support',conflict:false},{category:'content',aspect:'biology_genetics',direction:'seek_support',conflict:false},{category:'tone',aspect:'suspense',direction:'seek_support',conflict:false}]});
 assert.equal(policy.query,'science fiction film television biology genetics suspense');assert.deepEqual(policy.preference_indexes,[2,3]);assert(!JSON.stringify(policy).includes('PRIVATE_SENTINEL'));assert.equal(policy.maximum_searches,1);
 assertDailySearchRequest(policy,policy);
 assert.throws(()=>assertDailySearchRequest({...policy,request_id:'second-search'},policy),{code:'daily_search_limit'});
 assert.throws(()=>assertDailySearchRequest({...policy,query:'private text'},policy),{code:'invalid_search_request'});
 assert.throws(()=>assertDailySearchRequest({...policy,preference_indexes:[0]},policy),{code:'invalid_search_request'});
});
test('soft negative, conflicting and title-execution evidence cannot become a generic positive search term',()=>{
 for(const p of [{category:'content',aspect:'mystery',direction:'deprioritize_softly',conflict:false},{category:'tone',aspect:'horror',direction:'seek_support',conflict:true},{category:'execution',aspect:'pacing',direction:'seek_support',conflict:false}])assert.equal(dailySearchPolicy({genre:'mystery',preferences:[p]}).query,'mystery film television');
});
