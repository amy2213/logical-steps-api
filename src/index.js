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
function oneSentence(s){const t=String(s||'').trim().replace(/[.!?]\s*$/,'');return !/[.!?]\s+\S/.test(t);}
function validGist(g){if(typeof g!=='string')return false;const t=g.trim();return t.length>=20&&t.length<=180&&words(t).length>=4&&oneSentence(t)&&!BAD_GISTS.has(t.toLowerCase());}
function compactGist(text){const t=String(text||'').trim().replace(/\s+/g,' ');return t.length<=180?t:`${t.slice(0,177).trimEnd()}...`;}
function fallbackGist(nodes){const primary=nodes.find(n=>n.role==='conclusion'&&n.conclusionType==='primary')||nodes.find(n=>n.role==='conclusion')||nodes[nodes.length-1];return compactGist(primary?.plain||'The text presents a connected set of claims and supporting reasons.');}
function hasConcessionCue(text){return /\b(while proponents|while opponents|critics? (?:say|argue|claim)|opponents? (?:say|argue|claim)|supporters? (?:say|argue|claim)|some (?:say|argue|claim)|i understand|although .*?(?:say|argue|claim)|admittedly|to be fair)\b/i.test(text);}
function hasMiniArgumentCue(text){return /\b(if .+? then|therefore|thus|so,? |for that reason|which means|as a result)\b/i.test(text);}
function needsRepair(value,text){if(!validGist(value?.gist)||!Array.isArray(value?.nodes))return true;const nodes=value.nodes;const primary=nodes.filter(n=>n?.role==='conclusion'&&n?.conclusionType==='primary').length;if(primary!==1)return true;if(hasConcessionCue(text)&&!nodes.some(n=>n?.role==='counterpoint'))return true;if(hasMiniArgumentCue(text)&&nodes.filter(n=>n?.role==='conclusion').length<2&&nodes.length>=5)return true;return false;}

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
  const original=typeof raw.original==='string'?raw.original.trim():'';
  const role=raw.role==='assumption'&&original?'premise':raw.role;
  const node={id,role,plain:raw.plain.trim(),original:role==='assumption'?'':original,dependsOn:Array.isArray(raw.dependsOn)?raw.dependsOn.filter(x=>typeof x==='string'):[]};
  if(role==='conclusion')node.conclusionType=raw.conclusionType==='primary'?'primary':'intermediate';
  if(typeof raw.confidence==='number'&&raw.confidence>=0&&raw.confidence<=1)node.confidence=raw.confidence;
  if(similar(node.plain,node.original)>=.9)node.original='';
  return node;
 });
 for(const node of nodes){node.dependsOn=node.dependsOn.filter(id=>ids.has(id)&&id!==node.id);const raw=value.nodes.find(n=>n?.id===node.id);if(node.dependsOn.length&&CONNECTIVES.has(raw?.connective))node.connective=raw.connective;}
 const conclusions=nodes.filter(n=>n.role==='conclusion');
 if(conclusions.length){let primary=conclusions.filter(n=>n.conclusionType==='primary');if(primary.length===0)conclusions[conclusions.length-1].conclusionType='primary';if(primary.length>1){for(const n of primary.slice(0,-1))n.conclusionType='intermediate';}}
 const gist=validGist(value.gist)?value.gist.trim():fallbackGist(nodes);
 return{id:crypto.randomUUID(),sourceText,gist,nodes,meta:{model:MODEL,elapsedMs}};
}

function prompt(repair=false){return `You map arguments for neurodivergent readers. Return JSON only.${repair?' The previous answer missed an argument role or quality rule; correct it carefully.':''}
Shape: {"gist":"one sentence, 20-180 characters","nodes":[{"id":"n1","role":"context|premise|conclusion|assumption|counterpoint","conclusionType":"primary|intermediate when role is conclusion","plain":"genuine plain-language rewrite","original":"exact source wording, or empty for assumptions","connective":"because|therefore|unless|but|if/then","dependsOn":[],"confidence":0.9}]}
Rules:
- connective describes how THIS node follows from dependsOn; omit it when dependsOn is empty.
- Identify exactly one main conclusion as conclusionType primary.
- Mark a supported claim that later supports another claim as conclusionType intermediate. Mini-arguments must not be flattened into premises.
- Context only sets the scene. A reason the author endorses is premise.
- Counterpoint means a view the author reports, concedes, or acknowledges without endorsing. Clauses such as "While proponents assert..." and "I understand the team has been stretched thin" are counterpoints when the author then argues another position.
- Do not label the author's own warning or reason as counterpoint. "Using placeholder data would reflect poorly on the team" is a premise when the author uses it to support waiting for real data.
- Add an assumption only when an unstated bridge is necessary. Assumptions must have original:"".
- Rewrite plain substantially and conversationally; preserve uncertainty and qualifiers.
- Gist must be one concise sentence, 20-180 characters, focused on the primary conclusion.
Example 1: Text: "While proponents assert that increased density would ease the housing shortage, the proposal lacks transit funding, so the council should delay approval."
Output: {"gist":"The council should delay the density proposal because it lacks transit funding despite supporters' housing argument.","nodes":[{"id":"n1","role":"counterpoint","plain":"Supporters say greater density would reduce the housing shortage.","original":"While proponents assert that increased density would ease the housing shortage","dependsOn":[]},{"id":"n2","role":"premise","plain":"The proposal does not include transit funding.","original":"the proposal lacks transit funding","dependsOn":[]},{"id":"n3","role":"conclusion","conclusionType":"primary","plain":"The council should delay approving the proposal.","original":"the council should delay approval","dependsOn":["n1","n2"],"connective":"therefore"}]}
Example 2: Text: "I understand the team has been stretched thin. But placeholder data would reflect poorly on everyone, so we should wait for the verified figures."
Output: {"gist":"The team should wait for verified figures because placeholder data would damage its credibility.","nodes":[{"id":"n1","role":"counterpoint","plain":"The team has been under heavy workload pressure.","original":"I understand the team has been stretched thin","dependsOn":[]},{"id":"n2","role":"premise","plain":"Placeholder data would make the team look unreliable.","original":"placeholder data would reflect poorly on everyone","dependsOn":[]},{"id":"n3","role":"conclusion","conclusionType":"primary","plain":"The team should wait for verified figures.","original":"we should wait for the verified figures","dependsOn":["n1","n2"],"connective":"therefore"}]}
Example 3: Text: "Daniel's membership expired. If he returns, he must pay the standard rate. Therefore, the desk should not promise him the old discount."
Output: {"gist":"The desk should not promise Daniel the old discount because a returning member must pay the standard rate.","nodes":[{"id":"n1","role":"premise","plain":"Daniel's membership is no longer active.","original":"Daniel's membership expired","dependsOn":[]},{"id":"n2","role":"conclusion","conclusionType":"intermediate","plain":"If Daniel comes back, he must pay the standard rate.","original":"If he returns, he must pay the standard rate","dependsOn":["n1"],"connective":"if/then"},{"id":"n3","role":"conclusion","conclusionType":"primary","plain":"The desk should not promise Daniel his former discount.","original":"the desk should not promise him the old discount","dependsOn":["n2"],"connective":"therefore"}]}`;}

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
 try{let model=await callModel(env,text,false);if(needsRepair(model,text))model=await callModel(env,text,true);const analysis=normalize(model,text,Date.now()-started);return reply(analysis,200,origin,{'X-RateLimit-Limit':'10','X-RateLimit-Remaining':String(perIp.remaining)});}catch(error){console.error('Analysis failed',{message:error instanceof Error?error.message:'Unknown error',detail:error?.detail});return reply({error:{code:error?.status?'UPSTREAM_ERROR':'INVALID_ANALYSIS',message:error?.status?'The analysis provider could not complete this request.':'The provider returned an invalid logical map.'}},502,origin);}
}};
