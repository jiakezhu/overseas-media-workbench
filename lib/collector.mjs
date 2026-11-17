import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

export function isPublicAddress(address) {
  const family=isIP(address);if(!family)return false;
  if(family===6){const a=address.toLowerCase();return /^[23]/.test(a)&&!a.startsWith('2001:db8:')&&!a.startsWith('2001:0:');}
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
export function checkPublicUrl(input) {
  let u;try{u=new URL(input);}catch{throw new Error('请输入完整网页或 RSS 链接。');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw new Error('只支持不含账号密码的公开 HTTP(S) 网页。');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)||isIP(host)&&!isPublicAddress(host))throw new Error('不支持本机或内网地址。');
  return u;
}
export async function fetchPublicDocument(input,{redirects=0,lookupFn=lookup}={}) {
  const u=checkPublicUrl(input);if(redirects>4)throw new Error('来源重定向次数过多。');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookupFn(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('来源未解析到可访问的公开地址。');
  const result=await new Promise((resolve,reject)=>{
    const make=u.protocol==='https:'?httpsRequest:httpRequest;
    const req=make(u,{headers:{'user-agent':'MediaBDWorkbench/1.0 (personal research)','accept':'application/rss+xml, application/atom+xml, application/xml, text/html, text/plain;q=0.8','accept-encoding':'identity'},lookup:(_hostname,opts,cb)=>{if(opts?.all)cb(null,addresses);else cb(null,addresses[0].address,addresses[0].family);}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();return resolve({redirect:new URL(res.headers.location,u).href});}
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error(`来源返回 ${res.statusCode}，可以手动粘贴标题与链接。`));}
      const type=String(res.headers['content-type']||'').toLowerCase();
      if(!/(text|xml|rss|atom|json)/.test(type)){res.resume();return reject(new Error('该来源不是网页或订阅源。'));}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(new Error('来源内容过大，请直接填写摘要。'));}else chunks.push(chunk);});
      res.on('end',()=>resolve({url:u.href,contentType:type,body:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);
    });
    req.setTimeout(15000,()=>req.destroy(new Error('来源访问超时，请直接粘贴链接与摘要。')));req.on('error',reject);req.end();
  });
  if(result.redirect)return fetchPublicDocument(result.redirect,{redirects:redirects+1,lookupFn});
  return result;
}

// Model credentials must never follow redirects or reach a private network.
export async function postPublicJson(input,payload,apiKey,{lookupFn=lookup}={}) {
  const u=checkPublicUrl(input);
  if(u.protocol!=='https:')throw new Error('模型接口必须使用 HTTPS。');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookupFn(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('模型接口必须是公开地址。');
  const data=JSON.stringify(payload);
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(u,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`,'content-length':Buffer.byteLength(data)},lookup:(_h,opts,cb)=>opts?.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error(`模型服务返回 ${res.statusCode}。请检查接口、模型名称和额度。`));}
      let raw='';res.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>1024*1024)res.destroy(new Error('模型响应过大。'));});res.on('error',reject);
      res.on('end',()=>{try{resolve(JSON.parse(raw));}catch{reject(new Error('模型服务未返回有效 JSON。'));}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('模型请求超时，请稍后重试。')),60000);
    req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new Error('模型连接失败，请检查接口配置或网络。')));req.end(data);
  });
}
