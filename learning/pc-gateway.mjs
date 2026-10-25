// Access-protected Workers frontend -> one fixed private PC VPC Service.
// No GitHub credentials, signing, search, storage, publication or activation.
import {Buffer} from 'node:buffer';
import {createAccessAuthenticator} from './access-auth.mjs';

const limit=1024*1024;
const closed=(status,error)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
async function boundedBody(body,signal){
 if(!body)return Buffer.alloc(0);
 const reader=body.getReader(),chunks=[];let bytes=0,done=false;
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){
   if(signal.aborted)throw Error('aborted');
   const chunk=await reader.read();
   if(signal.aborted)throw Error('aborted');
   if(chunk.done){done=true;break;}
   bytes+=chunk.value.byteLength;if(bytes>limit)throw Error('body_limit');chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
 }finally{
  signal.removeEventListener('abort',cancel);
  if(!done)cancel();reader.releaseLock();
 }
}
function jsonBody(bytes){
 const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw Error('invalid_utf8');
 const body=JSON.parse(text);
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_rpc');
 return body;
}
export function createPrivatePcGateway({access,publicOrigin,port,binding}={},dependencies={}){
 if(typeof publicOrigin!=='string'||!/^https:\/\/[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.workers\.dev$/.test(publicOrigin)||
  !Number.isInteger(port)||port<1024||port>65535||typeof binding?.fetch!=='function')throw Error('invalid_private_gateway_config');
 const authenticate=createAccessAuthenticator(access,dependencies),target=`http://127.0.0.1:${port}`;
 return Object.freeze({async fetch(request){
  let url;try{url=new URL(request.url);}catch{return closed(400,'private_gateway_request_denied');}
  if(url.origin!==publicOrigin||url.search||url.hash||request.headers.has('origin')||request.headers.has('upgrade'))return closed(403,'private_gateway_request_denied');
  const assertion=request.headers.get('cf-access-jwt-assertion');
  if(!await authenticate(assertion))return closed(401,'private_gateway_unauthorized');
  const health=url.pathname==='/healthz'&&request.method==='GET';
  if(!health&&(url.pathname!=='/mcp'||request.method!=='POST'))return closed(405,'private_gateway_request_denied');
  if(!health&&(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')||request.headers.has('content-encoding')))return closed(415,'private_gateway_request_denied');
  if(Number(request.headers.get('content-length'))>limit)return closed(413,'private_gateway_request_limit');
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,30000);
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  let upstream,bytes,rpc;
  try{
   if(!health){
    try{
     bytes=await boundedBody(request.body,controller.signal);rpc=jsonBody(bytes);
     if(rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||
      rpc.id!==undefined&&!(typeof rpc.id==='string'&&rpc.id.length<=128||typeof rpc.id==='number'&&Number.isSafeInteger(rpc.id)))throw Error('invalid_rpc');
    }catch(error){return closed(controller.signal.aborted?504:error.message==='body_limit'?413:400,'private_gateway_request_denied');}
   }
   // Deliberately build headers and destination from constants/configuration.
   // Never forward caller cookies, bearer credentials, Host, or target URLs.
   const headers={'Cf-Access-Jwt-Assertion':assertion,Accept:'application/json, text/event-stream'};
   if(!health)headers['Content-Type']='application/json';
   const protocol=request.headers.get('mcp-protocol-version');
   if(protocol){if(!/^\d{4}-\d{2}-\d{2}$/.test(protocol))return closed(400,'private_gateway_request_denied');headers['MCP-Protocol-Version']=protocol;}
   // Modern MCP mirrors method/tool identity in these standard headers. The
   // official origin SDK checks them against the unchanged body before dispatch.
   for(const name of ['Mcp-Method','Mcp-Name']){
    const value=request.headers.get(name);
    if(value!==null){if(! /^[\x20-\x7e]{1,256}$/.test(value))return closed(400,'private_gateway_request_denied');headers[name]=value;}
   }
   // One attempt only. An ambiguous backend outcome never triggers a replay.
   upstream=await binding.fetch(target+(health?'/healthz':'/mcp'),{method:health?'GET':'POST',headers,
    body:health?undefined:bytes,redirect:'manual',signal:controller.signal});
   if(controller.signal.aborted)throw Error('aborted');
   if(Number(upstream.headers.get('content-length'))>limit)throw Error('upstream_limit');
   const response=await boundedBody(upstream.body,controller.signal);
   if(upstream.status===202&&!health&&rpc.id===undefined&&response.length===0)return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
   if(!/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type')||''))throw Error('upstream_denied');
   const value=jsonBody(response);
   // Preserve protocol negotiation/rejection statuses, not raw backend errors.
   // A 5xx is still an uncertain outcome and never becomes a retry/downgrade hint.
   if(!health&&rpc.id!==undefined&&value.jsonrpc==='2.0'&&value.id===rpc.id&&
    (upstream.status===400&&[-32020,-32021,-32022,-32602].includes(value.error?.code)||
     upstream.status===404&&value.error?.code===-32601)){
    const error={code:value.error.code,message:'Private MCP protocol request rejected'};
    if(error.code===-32022){
     const allowed=new Set(['2026-07-28','2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07']);
     const supported=value.error.data?.supported;
     if(Array.isArray(supported)&&supported.length&&supported.length<=allowed.size&&supported.every(version=>allowed.has(version)))error.data={supported:[...new Set(supported)]};
    }
    return Response.json({jsonrpc:'2.0',id:rpc.id,error},{status:upstream.status,headers:{'Cache-Control':'no-store'}});
   }
   if(upstream.status!==200)throw Error('upstream_denied');
   if(health){
    // Health advertises transport only, never an assertion about learning.
    if(value.schema_version!==1||value.transport!=='ready'||value.learning_activation!=='not_asserted'||value.publication_capability!==false)throw Error('upstream_denied');
    return Response.json({schema_version:1,transport:'ready',learning_activation:'not_asserted',publication_capability:false},{headers:{'Cache-Control':'no-store'}});
   }
   if(value.jsonrpc!=='2.0'||rpc.id===undefined||value.id!==rpc.id||!('result' in value||'error' in value))throw Error('upstream_denied');
   return new Response(response,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return closed(controller.signal.aborted?504:502,'private_gateway_upstream_pending');}
  finally{
   clearTimeout(timer);request.signal.removeEventListener('abort',abort);
   try{await upstream?.body?.cancel();}catch{}
  }
 }});
}

const gateways=new WeakMap();
export default {async fetch(request,env){
 // An example deployment cannot expose anything merely by being uploaded.
 if(env?.PRIVATE_GATEWAY_ENABLED!=='true')return closed(503,'private_gateway_held');
 try{
  let gateway=gateways.get(env);
  if(!gateway){
   if(!/^\d{4,5}$/.test(env.PRIVATE_PC_PORT||''))throw Error('invalid_config');
   gateway=createPrivatePcGateway({access:{issuer:env.ACCESS_ISSUER,audience:env.ACCESS_AUDIENCE,
    subject:env.ACCESS_OWNER_SUBJECT,email:env.ACCESS_OWNER_EMAIL},publicOrigin:env.PRIVATE_GATEWAY_ORIGIN,
    port:Number(env.PRIVATE_PC_PORT),binding:env.PRIVATE_RESEARCH});gateways.set(env,gateway);
  }
  return await gateway.fetch(request);
 }catch{return closed(503,'private_gateway_unconfigured');}
}};
