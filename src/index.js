const OPENROUTER_URL='https://openrouter.ai/api/v1/chat/completions';
const TURNSTILE_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MODEL='openai/gpt-4o-mini';
const SITE_URL='https://amy2213.github.io/logical-steps-dashboard/';
const ORIGINS=new Set(['http://localhost:5173','https://amy2213.github.io']);
const ROLES=new Set(['context','premise','conclusion','assumption','counterpoint']);
const CONNECTIVES=new Set(['because','therefore','unless','but','if/then']);
const BAD_GISTS=new Set(['summary','gist','response','string','analysis']);

function cors(origin){return{...(origin&&ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'Retry-After,X-RateLimit-Limit,X-RateLimit-Remaining',Vary:'Origin'};}
function reply(body,status,origin,extra={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(origin),...extra}});}
function parseJson(content){if(typeof content!=='string'||!content.trim())throw new Error('Empty model response.');return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,''));}
function words(s){return String(s||'').toLowerCase().match(/[a-z0-9]+/g)||[];}
function similar(a,b){const aa=new Set(words(a)),bb=new Set(words(b));if(!aa.size||!bb.size)return 0;let common=0;for(const w of aa)if(bb.has(w))common++;return common/Math.max(aa.size,bb.size);}
function validGist(g){if(typeof g!=='string')return false;const t=g.trim();return t.length>=20&&words(t).length>=4&&!BAD_GISTS.has(t.toLowerCase());}
function fallbackGist(nodes){const primary=nodes.find(n=>n.role==='conclusion'&&n.conclusionType==='primary')||nodes.find(n=>n.role==='conclusion')||nodes[nodes.length-1];return primary?.plain||'The text presents a connected set of claims and supporting reasons.';}

function normalize(value,sourceText,elapsedMs){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Analysis must be an object.');
 if(!Array.isArray(value.nodes)||!value.nodes.length)throw new Error('Analysis nodes are missing.');
 const ids=new Set();
 const nodes=value.nodes.map((raw,i)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`Node ${i+1} is invalid.`);
  const id=typeof raw.id==='string'&&raw.id.trim()?raw.id.trim():`n${i+1}`;
  if(ids.has(id))throw new Error('Node IDs must be unique.');ids.add(id);
  if(!ROLES.has(raw.role))throw new Error(`Unknown node role: ${raw.role}`);
  if(typeof raw.plain!=='string'||!raw.plain.trim())throw new Error('Every node requires plain text.');
  const node={id,role:raw.role,plain:raw.plain.trim(),original:typeof raw.original==='string'?raw.original:'',dependsOn:Array.isArray(raw.dependsOn)?raw.dependsOn.filter(x=>typeof x==='string'):[]};
  if(raw.role==='conclusion')node.conclusionType=raw.conclusionType==='primary'?'primary':'intermediate';
  if(typeof raw.confidence==='number'&&raw.confidence>=0&&raw.confidence<=1)node.confidence=raw.confidence;
  if(similar(node.plain,node.original)>=.9)node.original='';
  return node;
 });
 for(const node of nodes){node.dependsOn=node.dependsOn.filter(id=>ids.has(id)&&id!==node.id);if(node.dependsOn.length&&CONNECTIVES.has(value.nodes.find(n=>n?.id===node.id)?.connective))node.connective=value.nodes.find(n=>n?.id===node.id).connective;}
 const conclusions=nodes.filter(n=>n.role==='conclusion');if(conclusions.length&&!conclusions.some(n=>n.conclusionType==='primary'))conclusions[conclusions.length-1].conclusionType='primary';
 const gist=validGist(value.gist)?value.gist.trim():fallbackGist(nodes);
 return{id:crypto.randomUUID(),sourceText,gist,nodes,meta:{model:MODEL,elapsedMs}};
}

function prompt(repair=false){return `You map arguments for neurodivergent readers. Return JSON only.${repair?' The previous answer failed quality checks; correct it carefully.':''}
Shape: {"gist":"one useful sentence, never a placeholder","nodes":[{"id":"n1","role":"context|premise|conclusion|assumption|counterpoint","conclusionType":"primary|intermediate when role is conclusion","plain":"genuine plain-language rewrite","original":"exact source wording, or empty for assumptions","connective":"because|therefore|unless|but|if/then","dependsOn":[],"confidence":0.9}]}
Rules:
- connective describes how THIS node follows from dependsOn; omit it when dependsOn is empty.
- Identify the author's main conclusion as conclusionType primary; other conclusions are intermediate.
- Context only sets the scene. A reason offered in support is premise. An opposing view is counterpoint.
- Add an assumption only when an unstated bridge is necessary; never invent one just to fill the role.
- Rewrite plain substantially and conversationally; do not copy original unless no clearer wording is possible.
- Preserve uncertainty and qualifiers. Never claim the argument is factually true.
Example: Text: "Retention rose after flexible hours began, so the policy works. Critics say output may fall."
Output: {"gist":"The author argues flexible hours work because retention improved, while acknowledging concern about productivity.","nodes":[{"id":"n1","role":"premise","plain":"Employee retention improved after flexible hours started.","original":"Retention rose after flexible hours began","dependsOn":[]},{"id":"n2","role":"assumption","plain":"The timing suggests flexible hours caused the retention improvement.","original":"","dependsOn":["n1"],"connective":"because"},{"id":"n3","role":"counterpoint","plain":"Critics worry flexible hours could reduce output.","original":"Critics say output may fall","dependsOn":[],"connective":"but"},{"id":"n4","role":"conclusion","conclusionType":"primary","plain":"The flexible-hours policy is effective.","original":"the policy works","dependsOn":["n1","n2"],"connective":"therefore"}]}`;}

async function callModel(env,text,repair=false){
 const r=await fetch(OPENROUTER_URL,{method:'POST',headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':SITE_URL,'X-OpenRouter-Title':'Logical Steps Dashboard'},body:JSON.stringify({model:MODEL,temperature:.1,max_tokens:2400,response_format:{type:'json_object'},messages:[{role:'system',content:prompt(repair)},{role:'user',content:text}]})});
 const raw=await r.text();if(!r.ok)throw Object.assign(new Error('The analysis provider rejected the request.'),{status:r.status,detail:raw.slice(0,500)});return parseJson(JSON.parse(raw)?.choices?.[0]?.message?.content);
}
async function verifyTurnstile(env,token,ip){if(!env.TURNSTILE_SECRET_KEY)return true;if(typeof token!=='string'||!token)return false;const r=await fetch(TURNSTILE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:ip})});return Boolean((await r.json()).success);}
async function takeLimit(env,name,key,limit,windowMs){const id=env.RATE_LIMITER.idFromName(name);const r=await env.RATE_LIMITER.get(id).fetch('https://limit.local/take',{method:'POST',body:JSON.stringify({key,limit,windowMs})});return r.json();}

export class RateLimiter{constructor(state){this.state=state;}async fetch(request){const {key,limit,windowMs}=await request.json();const now=Date.now();const record=await this.state.storage.get(key)||{start:now,count:0};if(now-record.start>=windowMs){record.start=now;record.count=0;}record.count++;await this.state.storage.put(key,record);const reset=Math.max(1,Math.ceil((record.start+windowMs-now)/1000));return Response.json({allowed:record.count<=limit,remaining:Math.max(0,limit-record.count),reset});}}

export default{async fetch(request,env){
 const started=Date.now(),origin=request.headers.get('Origin'),url=new URL(request.url);
 if(request.method==='OPTIONS'){if(!origin||!ORIGINS.has(origin))return new Response(null,{status:403});return new Response(null,{status:204,headers:cors(origin)});}
 if(url.pathname==='/health'&&request.method==='GET')return reply({ok:true,service:'logical-steps-api'},200,origin);
 if(url.pathname!=='/v1/analyze'||request.method!=='POST')return reply({error:{code:'NOT_FOUND',message:'Route not found.'}},404,origin);
 if(origin&&!ORIGINS.has(origin))return reply({error:{code:'ORIGIN_NOT_ALLOWED',message:'This origin is not allowed.'}},403,origin);
 if(!env.OPENROUTER_API_KEY||!env.RATE_LIMITER)return reply({error:{code:'SERVER_CONFIGURATION_ERROR',message:'The analysis service is not configured.'}},500,origin);
 let body;try{body=await request.json();}catch{return reply({error:{code:'INVALID_JSON',message:'Request body must be valid JSON.'}},400,origin);}
 const text=typeof body?.text==='string'?body.text.trim():'';if(!text)return reply({error:{code:'INVALID_TEXT',message:'A non-empty text field is required.'}},400,origin);if(text.length>12000)return reply({error:{code:'TEXT_TOO_LONG',message:'Text must be 12,000 characters or fewer.'}},413,origin);
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 const human=await verifyTurnstile(env,body.turnstileToken,ip);if(!human)return reply({error:{code:'HUMAN_VERIFICATION_FAILED',message:'Please complete the human verification and try again.'}},403,origin);
 const perIp=await takeLimit(env,`ip:${ip}`,ip,10,10*60*1000);if(!perIp.allowed)return reply({error:{code:'RATE_LIMITED',message:'Too many analyses from this connection. Please wait before trying again.'}},429,origin,{'Retry-After':String(perIp.reset),'X-RateLimit-Limit':'10','X-RateLimit-Remaining':'0'});
 const global=await takeLimit(env,'global-daily','all',300,24*60*60*1000);if(!global.allowed)return reply({error:{code:'DAILY_LIMIT_REACHED',message:'Logical Steps has reached its daily analysis limit. Please try again tomorrow.'}},429,origin,{'Retry-After':String(global.reset)});
 try{let model=await callModel(env,text,false);let analysis=normalize(model,text,Date.now()-started);if(!validGist(model.gist)){model=await callModel(env,text,true);analysis=normalize(model,text,Date.now()-started);}return reply(analysis,200,origin,{'X-RateLimit-Limit':'10','X-RateLimit-Remaining':String(perIp.remaining)});}catch(error){console.error('Analysis failed',{message:error instanceof Error?error.message:'Unknown error',detail:error?.detail});return reply({error:{code:error?.status?'UPSTREAM_ERROR':'INVALID_ANALYSIS',message:error?.status?'The analysis provider could not complete this request.':'The provider returned an invalid logical map.'}},502,origin);}
}};
