// Closed operational evidence only. Never include URLs, paths, payloads,
// repository contents, response bodies, credentials or exception messages.
const operations=new Set(['rest_read','git_write','current_heads','immutable_blobs','workflow_dispatch']);
const records=new WeakMap();
export function githubHttpSummary(response,operation){
 if(!operations.has(operation)||!Number.isInteger(response?.status))return undefined;
 const output={operation,status:response.status};
 for(const [header,key,pattern] of [
  ['x-github-request-id','request_id',/^[A-Fa-f0-9:]{1,96}$/],
  ['x-ratelimit-resource','resource',/^(?:core|graphql|search|integration_manifest|code_search|actions_runner_registration)$/],
  ['x-ratelimit-remaining','remaining',/^\d{1,12}$/],['x-ratelimit-reset','reset',/^\d{1,13}$/],['retry-after','retry_after',/^\d{1,6}$/]]){
  const value=response.headers?.get(header);if(typeof value==='string'&&pattern.test(value))output[key]=value;
 }
 return Object.freeze(output);
}
export function attachGitHubSummary(error,summary){if(error instanceof Error&&summary)records.set(error,summary);return error;}
export function githubErrorSummary(error){return records.has(error)?{github:records.get(error)}:{};}
