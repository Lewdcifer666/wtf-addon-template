// PC-local transport, not publication or activation. Default adapter is held.
// A cloud connection requires a separately approved authenticated HTTPS path.
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createPrivateResearchTaskAdapter,researchTaskCallSchema,privateTaskErrorCode} from './research-task-adapter.mjs';
import {createAccessAuthenticator} from './access-auth.mjs';

const descriptions={
 open:'Open current private learning context and persist its private provenance. Requires an authorized active deployment. Never use for a held operation.',
 context:'Read current private context using this authenticated service session. Keep its response private.',
 search:'Run a public-source search through the configured provider and persist private evidence. Reuse the same request ID for unchanged retries; stop on a hold or denial.',
 verify:'Verify this session against an already staged public research commit. Does not stage, publish or claim a learning effect.'
};
const specs=researchTaskCallSchema().oneOf;
const tools=specs.map(spec=>{
 const operation=spec.properties.operation.const;
 return {name:`private_research_${operation}`,description:descriptions[operation],inputSchema:spec.properties.request,
  annotations:{readOnlyHint:['context','verify'].includes(operation),destructiveHint:false,
   idempotentHint:true,openWorldHint:operation==='search'}};
});
const validators=new Map(tools.map(tool=>[tool.name,new Ajv({strict:true,allErrors:false}).compile(tool.inputSchema)]));
const reply=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,...(isError?{isError:true}:{})});
const failure=code=>reply({schema_version:1,error:code},true);
export function createResearchMcpServer(adapter=createPrivateResearchTaskAdapter({})){
 if(typeof adapter?.dispatch!=='function')throw Error('invalid_private_adapter');
 const server=new Server({name:'wtf-private-research',version:'1.0.0'},
  {capabilities:{tools:{}},instructions:'Private learning tools only. A hold or denial means stop; never retry using a different tool, ID or writer. Keep all context/results private. Tools cannot stage AI packets, publish, change activation or prove a recommendation effect.'});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:structuredClone(tools)}));
 server.setRequestHandler(CallToolRequestSchema,async({params},{requestId})=>{
  const validate=validators.get(params.name);if(!validate||!validate(params.arguments))return failure('invalid_task_call');
  const operation=params.name.slice('private_research_'.length);
  try{
   const result=await adapter.dispatch({schema_version:1,operation,request:structuredClone(params.arguments)});
   const response=reply(result);
   // Text and structuredContent both carry the value; count escaped JSON and
   // the RPC envelope too, not merely the adapter's unduplicated object.
   if(Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:requestId,result:response}),'utf8')>1024*1024)return failure('private_task_failed');
   return response;
  }catch(error){return failure(privateTaskErrorCode(error));}
 });
 // No raw request, result, credential or exception logging.
 server.onerror=()=>{};return server;
}

export async function startLocalResearchMcpHost({bearerToken,access,adapter,port=0}={}){
 if(access!==undefined&&bearerToken!==undefined)throw Error('ambiguous_private_host_auth');
 if(access===undefined&&(typeof bearerToken!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(bearerToken)))throw Error('private_host_credentials_required');
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('invalid_private_host_port');
 const installedAdapter=adapter??createPrivateResearchTaskAdapter({});
 if(typeof installedAdapter.dispatch!=='function')throw Error('invalid_private_adapter');
 const accessAuth=access===undefined?null:createAccessAuthenticator(access);
 const expected=accessAuth?null:createHash('sha256').update('Bearer '+bearerToken).digest();
 const authorized=async req=>{
  if(accessAuth){
   const assertions=req.rawHeaders.filter((_,index)=>index%2===0&&req.rawHeaders[index].toLowerCase()==='cf-access-jwt-assertion');
   return assertions.length===1&&await accessAuth(req.headers['cf-access-jwt-assertion']);
  }
  const header=req.headers.authorization;
  return typeof header==='string'&&header.length<=256&&timingSafeEqual(expected,createHash('sha256').update(header).digest());
 };
 const http=createServer({maxHeaderSize:8192},async(req,res)=>{
  const end=(status,code)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:code}));};
  // Direct callers must be local and authenticate even for initialization/list.
  const localPort=req.socket.localPort;
  if(![`127.0.0.1:${localPort}`,`localhost:${localPort}`].includes(req.headers.host)||req.headers.origin){end(403,'private_host_origin_denied');return;}
  if(!await authorized(req)){end(401,'private_host_unauthorized');return;}
  if(req.url==='/healthz'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({schema_version:1,transport:'ready',learning_activation:'not_asserted',publication_capability:false}));return;
  }
  if(req.url!=='/mcp'){end(404,'private_host_not_found');return;}
  if(req.method!=='POST'){end(405,'private_host_method_denied');return;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')||req.headers['content-encoding']){end(415,'private_host_content_type');return;}
  if(Number(req.headers['content-length'])>1024*1024){end(413,'private_host_request_limit');return;}
  res.setHeader('Cache-Control','no-store');
  let body,bytes=0;const chunks=[];
  try{
   for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024){end(413,'private_host_request_limit');return;}chunks.push(chunk);}
   const raw=Buffer.concat(chunks),text=raw.toString('utf8');
   if(!Buffer.from(text,'utf8').equals(raw)){end(400,'invalid_private_host_request');return;}
   body=JSON.parse(text);
  }catch{end(400,'invalid_private_host_request');return;}
  // Reject batch requests; no call may bypass the task dispatcher's queue.
  if(!body||typeof body!=='object'||Array.isArray(body)){end(400,'invalid_private_host_request');return;}
  // Bound the echoed ID even for SDK-generated errors and initialization.
  if(body.id!==undefined&&!(typeof body.id==='string'&&body.id.length<=128||typeof body.id==='number'&&Number.isSafeInteger(body.id))){end(400,'invalid_private_host_request');return;}
  const server=createResearchMcpServer(installedAdapter),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void server.close();});
  try{await server.connect(transport);await transport.handleRequest(req,res,body);}
  catch{if(!res.headersSent)end(500,'private_host_request_failed');else res.end();}
 });
 http.requestTimeout=30000;http.headersTimeout=10000;
 await new Promise((resolve,reject)=>{http.once('error',reject);http.listen({host:'127.0.0.1',port},resolve);});
 return Object.freeze({url:`http://127.0.0.1:${http.address().port}/mcp`,
  close:async()=>{http.closeAllConnections();await new Promise((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 const local=args.length===2&&args[0]==='--port'&&/^\d{1,5}$/.test(args[1]);
 const access=args.length===4&&args[0]==='--access-config'&&args[2]==='--port'&&/^\d{1,5}$/.test(args[3]);
 if(!local&&!access){console.error('private-mcp: usage --port PORT or --access-config FILE --port PORT');process.exitCode=1;}
 else Promise.resolve().then(()=>{
  let options={bearerToken:process.env.PRIVATE_RESEARCH_MCP_TOKEN,port:Number(local?args[1]:args[3])};
  if(access){
   const info=fs.lstatSync(args[1]);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error('invalid_access_file');
   const raw=fs.readFileSync(args[1]),text=raw.toString('utf8');
   if(raw.length>4096||!Buffer.from(text,'utf8').equals(raw))throw Error('invalid_access_file');
   options={...options,access:JSON.parse(text)};
  }
  return startLocalResearchMcpHost(options);
 })
  .then(host=>{console.log('private-mcp: local transport ready; adapter held');
   for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void host.close().then(()=>process.exit(0));});})
  .catch(()=>{console.error('private-mcp: host_start_failed');process.exitCode=1;});
}
