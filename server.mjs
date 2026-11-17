import { createServer } from 'node:http';
import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomBytes,createHash } from 'node:crypto';
import { atomicJson,readJson,parseBaseUrl,syncBase,writeRecord,validateFields,runLark,EDIT_FIELDS } from './lib/feishu.mjs';
import { fetchPublicDocument } from './lib/collector.mjs';
import { canonicalUrl } from './lib/domain.mjs';
import { analyzeItem,validateModelConfig,publicModelConfig } from './lib/analysis.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const STATIC={'/':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css','/icon.svg':'public/icon.svg','/domain.mjs':'lib/domain.mjs'};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
export async function createWorkbench({root=ROOT,dataDir=join(root,'.data'),run=runLark,fetchDocument=fetchPublicDocument,analyze=analyzeItem}={}) {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const csrf=randomBytes(24).toString('hex');
  let snapshot=await readJson(join(dataDir,'snapshot.json'),null);
  let config=await readJson(join(dataDir,'config.json'),{baseUrl:process.env.FEISHU_BASE_URL||''});
  let prefs=await readJson(join(dataDir,'preferences.json'),{pinned:[],queries:['OTT sports streaming rights Asia','media AI newsroom Middle East','OTT platform launch Southeast Asia']});
  let inbox=await readJson(join(dataDir,'inbox.json'),[]);
  let receipts=await readJson(join(dataDir,'receipts.json'),{});
  let modelConfig=await readJson(join(dataDir,'model.json'),{});
  let analyzing=false;
  let job={state:'idle',done:0,total:7,message:''};let busy=false;
  const startSync=async()=>{
    if(busy)throw new Error('已有同步或保存正在进行，请稍候。');
    busy=true;job={state:'running',done:0,total:7,message:'正在读取 Base'};
    try{snapshot=await syncBase(config,{root,dataDir,run,onProgress:p=>job={state:'running',...p,message:p.table}});job={state:'success',done:7,total:7,message:'七张表已完整同步'};}
    catch(e){job={state:'error',message:e.message,done:job.done,total:7};}
    finally{busy=false;}
  };
  const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const body=async req=>{if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('请求需要 JSON 内容。');let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>512*1024)throw new Error('请求内容过大。');}return JSON.parse(data||'{}');};
  const server=createServer(async(req,res)=>{
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try{
      const host=String(req.headers.host||'');const allowed=/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
      if(!allowed)return json(res,403,{error:'仅支持通过本机地址访问。'});
      const u=new URL(req.url,`http://${host}`);
      if(req.headers.origin && req.headers.origin!==`http://${host}`)return json(res,403,{error:'不接受其他网站发起的请求。'});
      if(req.method!=='GET' && req.headers['x-workbench-token']!==csrf)return json(res,403,{error:'页面已过期，请刷新后重试。'});
      if(req.method==='GET'&&u.pathname==='/api/state')return json(res,200,{snapshot,config:{baseUrl:config.baseUrl},modelConfig:publicModelConfig(modelConfig),prefs,inbox,job,csrf,editFields:EDIT_FIELDS});
      if(req.method==='GET'&&u.pathname==='/api/status')return json(res,200,{job,busy});
      if(req.method==='POST'&&u.pathname==='/api/model-config'){
        const b=await body(req);const next=validateModelConfig(b,modelConfig);await atomicJson(join(dataDir,'model.json'),next);modelConfig=next;return json(res,200,{ok:true,modelConfig:publicModelConfig(next)});
      }
      if(req.method==='POST'&&u.pathname==='/api/analyze'){
        if(analyzing)throw new Error('已有分析正在进行，请稍候。');const b=await body(req);
        if(b.confirmation!=='analyze-selected-source')throw new Error('请先确认本次模型分析范围。');
        const item=inbox.find(i=>i.id===b.id);if(!item)throw new Error('未找到待分析情报。');
        analyzing=true;try{const analysis=await analyze(item,snapshot,modelConfig);const next=inbox.map(i=>i.id===item.id?{...i,analysis}:i);await atomicJson(join(dataDir,'inbox.json'),next);inbox=next;return json(res,200,{analysis});}finally{analyzing=false;}
      }
      if(req.method==='POST'&&u.pathname==='/api/config'){
        if(busy)throw new Error('正在同步，请完成后再更换连接。');const b=await body(req);const parsed=parseBaseUrl(b.baseUrl);
        if(snapshot && snapshot.baseUrl!==parsed.baseUrl)throw new Error('此工作目录已连接其他 Base。请使用新的本地数据目录，避免混合客户资料。');
        config={baseUrl:parsed.baseUrl};await atomicJson(join(dataDir,'config.json'),config);return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&u.pathname==='/api/sync'){if(busy)throw new Error('已有同步或保存正在进行，请稍候。');void startSync();return json(res,202,{ok:true});}
      if(req.method==='POST'&&u.pathname==='/api/preferences'){
        const b=await body(req);const next={...prefs};
        if(b.pinned)next.pinned=b.pinned.filter(x=>typeof x==='string').slice(0,200);
        if(b.queries)next.queries=b.queries.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.slice(0,300)).slice(0,12);
        if(b.sources)next.sources=b.sources.filter(x=>typeof x.url==='string'&&typeof x.name==='string'&&canonicalUrl(x.url)).map(x=>({name:x.name.slice(0,100),url:canonicalUrl(x.url)})).slice(0,30);
        await atomicJson(join(dataDir,'preferences.json'),next);prefs=next;return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&u.pathname==='/api/collect'){
        const b=await body(req);let target=b.url;
        if(b.query){if(typeof b.query!=='string'||b.query.length>300)throw new Error('关键词请控制在 300 字内。');const days=[0,7,30,90].includes(Number(b.days))?Number(b.days):30;target='https://news.google.com/rss/search?'+new URLSearchParams({q:b.query+(days?' when:'+days+'d':''),hl:'en-US',gl:'US',ceid:'US:en'});}
        const doc=await fetchDocument(target);return json(res,200,doc);
      }
      if(req.method==='POST'&&u.pathname==='/api/inbox-item'){
        const b=await body(req);const item=inbox.find(i=>i.id===b.id);if(!item)throw new Error('未找到采集草稿。');
        const url=canonicalUrl(b.url);const title=String(b.title||'').trim();if(!url||!title)throw new Error('请填写标题和公开来源链接。');
        if(inbox.some(i=>i.id!==b.id&&canonicalUrl(i.url)===url)||(snapshot?.tables?.intelligence?.records||[]).some(r=>canonicalUrl(r['来源链接'])===url))throw new Error('该来源已在收件箱或 Base 中，请核对重复记录。');
        const next=inbox.map(i=>i.id===b.id?{...i,title:title.slice(0,500),url,excerpt:String(b.excerpt||'').slice(0,18000),publishedAt:String(b.publishedAt||'').slice(0,100),analysis:undefined}:i);
        await atomicJson(join(dataDir,'inbox.json'),next);inbox=next;return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&u.pathname==='/api/inbox'){
        const b=await body(req);if(!Array.isArray(b.items)||b.items.length>50)throw new Error('每次最多收集 50 条。');
        const known=new Set(inbox.map(i=>canonicalUrl(i.url)));for(const r of snapshot?.tables?.intelligence?.records||[])known.add(canonicalUrl(r['来源链接']));
        const added=[];let duplicates=0;
        for(const x of b.items){const url=canonicalUrl(x.url);if(!url||!String(x.title||'').trim())throw new Error('每条情报都需要标题和公开来源链接。');if(known.has(url)){duplicates++;continue;}known.add(url);added.push({id:randomBytes(12).toString('hex'),title:String(x.title).slice(0,500),url,excerpt:String(x.excerpt||'').slice(0,12000),publishedAt:String(x.publishedAt||'').slice(0,100),collectedAt:new Date().toISOString(),status:'待核实'});}
        const next=[...added,...inbox];await atomicJson(join(dataDir,'inbox.json'),next);inbox=next;return json(res,200,{added:added.length,duplicates});
      }
      if(req.method==='POST'&&u.pathname==='/api/write'){
        if(!snapshot)throw new Error('请先连接并同步 Base。');if(busy)throw new Error('已有同步或保存正在进行，请稍候。');
        const b=await body(req);if(b.confirmation!=='write-to-feishu')throw new Error('请在保存预览中确认写入飞书。');
        if(!/^[A-Za-z0-9-]{16,80}$/.test(b.requestId||''))throw new Error('请求编号无效。');
        const fingerprint=createHash('sha256').update(JSON.stringify({key:b.key,recordId:b.recordId,values:b.values,expected:b.expected})).digest('hex');
        const previous=receipts[b.requestId];
        if(previous){if(previous.fingerprint!==fingerprint)throw new Error('请求编号已用于不同内容。');if(previous.result)return json(res,200,previous.result);throw new Error('该保存结果暂不确定，请先同步 Base 核对，不要重复提交。');}
        validateFields(snapshot,b.key,b.values);
        busy=true;receipts[b.requestId]={fingerprint,state:'pending',at:new Date().toISOString()};await atomicJson(join(dataDir,'receipts.json'),receipts);
        try{
          const result=await writeRecord(snapshot,b,{root,dataDir,run});
          receipts[b.requestId]={fingerprint,state:'done',result};await atomicJson(join(dataDir,'receipts.json'),receipts);
          if(b.inboxId){inbox=inbox.filter(i=>i.id!==b.inboxId);await atomicJson(join(dataDir,'inbox.json'),inbox);}
          // A successful remote write is reported even if the following refresh fails.
          busy=false;void startSync();return json(res,200,result);
        }catch(e){busy=false;receipts[b.requestId]={fingerprint,state:'uncertain',message:e.message};await atomicJson(join(dataDir,'receipts.json'),receipts);throw e;}
      }
      if(req.method==='GET'&&STATIC[u.pathname]){
        const file=STATIC[u.pathname];const ext=file.slice(file.lastIndexOf('.'));const data=await readFile(join(root,file));res.writeHead(200,{'content-type':MIME[ext],'cache-control':'no-cache'});return res.end(data);
      }
      return json(res,404,{error:'未找到页面或功能。'});
    }catch(e){json(res,400,{error:e.message||'操作未完成，请重试。'});}
  });
  return {server,startSync,getSnapshot:()=>snapshot};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {server}=await createWorkbench();const port=Number(process.env.PORT)||4317;
  server.listen(port,'127.0.0.1',()=>console.log(`出海情报工作台：http://127.0.0.1:${port}`));
}
