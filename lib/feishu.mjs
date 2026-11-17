import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalUrl,ids,realRows } from './domain.mjs';

const execFile = promisify(execFileCallback);
export const TABLE_KEYS = ['accounts','contacts','activities','opportunities','intelligence','playbook','funnel'];
const PREFIX = {accounts:'Accounts',contacts:'Contacts',activities:'Activities',opportunities:'Opportunities',intelligence:'Intelligence',playbook:'Playbook',funnel:'Funnel'};
export const EDIT_FIELDS = {
  accounts:['公司名称','官网','LinkedIn 公司主页','所属大区','国家','主要业务市场','母公司/集团','客户类型','开发赛道','业务简介','当前开发阶段','客户归属状态','信息可信度','业务触发点','技术信号','客户痛点假设','进入路径','采购/签约主体','技术团队所在地','已知云服务商','技术需求场景','信息来源','备注'],
  contacts:['姓名','所属公司','职位','LinkedIn 个人主页','工作邮箱','工作电话','国家','部门','决策链角色','建联状态','关系强度','首选沟通语言','信息可信度','信息来源','来源日期','在职风险','个人背景与业务职责','切入点假设','引荐路径','备注'],
  activities:['活动名称','对应公司','对应联系人','活动类型','活动日期','任务状态','优先级','沟通内容摘要','客户反馈','下一步动作','下次跟进日期','活动结果','相关材料链接'],
  opportunities:['商机名称','客户公司','主要联系人','商机场景','商机阶段','客户实际痛点','腾讯云产品','预计金额','币种','预计签约日期','现有技术架构','现有供应商','决策流程','下一步动作','POC 状态','POC 测试目标','POC 验收标准','技术风险','商业风险'],
  intelligence:['情报标题','关联客户','情报类别','国家/区域','新闻发布日期','事件发生日期','最近核实日期','已确认事实','潜在销售机会（分析假设）','建议销售动作','可能涉及的腾讯云产品','来源链接','信息可信度','是否已用于建联'],
};

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file,'utf8')); }
  catch (e) { if(e.code==='ENOENT') return structuredClone(fallback); throw e; }
}
export async function atomicJson(file, data) {
  const temp=`${file}.${randomUUID()}.tmp`;
  await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  await rename(temp,file);
}
export function parseBaseUrl(input) {
  let u;try{u=new URL(input);}catch{throw new Error('请输入完整的飞书 Base 链接。');}
  if(u.protocol!=='https:' || u.username || u.password || u.port || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname)) throw new Error('需要飞书或 Lark 的 HTTPS Base 链接。');
  const token=u.pathname.match(/^\/base\/([A-Za-z0-9]+)\/?$/)?.[1];
  if(!token)throw new Error('当前支持 /base/ 开头的多维表格链接。');
  u.hash='';return {baseToken:token,baseUrl:`${u.origin}/base/${token}`,origin:u.origin};
}
export async function runLark(args, {cwd,timeout=90000}={}) {
  try {
    const {stdout}=await execFile('lark-cli',['base',...args,'--as','user'],{cwd,timeout,maxBuffer:8*1024*1024,env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});
    const result=JSON.parse(stdout);if(result.ok===false)throw new Error(result.error?.message || '飞书请求失败');return result;
  } catch(e) {
    let d;try{d=JSON.parse(e.stderr || e.stdout || '{}');}catch{}
    if(e.code==='ENOENT')throw new Error('未找到 lark-cli。请先安装并完成飞书用户身份连接。');
    if(e.code===10 || d?.error?.subtype==='confirmation_required')throw new Error('该操作需要飞书额外确认，请回到飞书完成；本工作台不会绕过确认。');
    if(/keychain/i.test(d?.error?.message||e.message))throw new Error('飞书本机凭据暂不可读取。请从已登录飞书的系统终端启动工作台后重试。');
    throw new Error(d?.error?.message || (e.killed?'飞书请求超时，请刷新数据后检查结果。':e.message));
  }
}
async function parallelLimit(items,limit,fn) {
  const output=new Array(items.length);let next=0;let failed=false;
  const results=await Promise.allSettled(Array.from({length:Math.min(limit,items.length)},async()=>{while(!failed&&next<items.length){const i=next++;try{output[i]=await fn(items[i],i);}catch(error){failed=true;throw error;}}}));
  const rejection=results.find(r=>r.status==='rejected');if(rejection)throw rejection.reason;
  return output;
}
export async function syncBase(config, {root,dataDir,run=runLark,onProgress=()=>{}}) {
  const parsed=parseBaseUrl(config.baseUrl);
  const rawDir=join(dataDir,'sync-'+randomUUID());await mkdir(rawDir,{recursive:true,mode:0o700});
  const call=args=>run(args,{cwd:root});
  const listed=await call(['+table-list','--base-token',parsed.baseToken]);
  const tables=listed.data?.tables;if(!Array.isArray(tables))throw new Error('飞书未返回数据表列表。');
  const selected=TABLE_KEYS.map(key=>({key,...tables.find(t=>t.name.toLowerCase().startsWith(PREFIX[key].toLowerCase()))}));
  for(const t of selected)if(!t.id)throw new Error(`Base 缺少 ${PREFIX[t.key]} 表，未替换已有快照。`);
  let done=0;
  const result=await parallelLimit(selected,3,async table=>{
    const schema=await call(['+field-list','--base-token',parsed.baseToken,'--table-id',table.id]);
    const fields=schema.data?.fields;if(!Array.isArray(fields))throw new Error(`${table.name} 字段读取失败。`);
    const accountMetrics=['客户评分','客户优先级','评分已填项','Mapping 状态','漏斗阶段','联系人数','决策链覆盖','决策链缺口'];
    const projected=table.key==='accounts'?fields.filter(f=>f.type!=='formula'||accountMetrics.includes(f.name)):fields;
    if(projected.length>50)throw new Error(`${table.name} 超过 50 个所需字段，请收窄投影后重试。`);
    const records=[];let offset=0,rev=null,complete=false;
    for(let page=0;page<50;page++) {
      const file=join(rawDir,`${table.key}-${page}.ndjson`);
      const args=['+record-list','--base-token',parsed.baseToken,'--table-id',table.id,'--offset',String(offset),'--limit','2000','--format','ndjson','--output',relative(root,file)];
      for(const field of projected)args.push('--field-id',field.id);
      const m=await call(args);
      if(typeof m.has_more!=='boolean')throw new Error(`${table.name} 缺少分页完整性标志。`);
      if(rev!==null && m.rev!==rev)throw new Error(`${table.name} 读取期间发生变化，请重新同步。`);rev=m.rev;
      const text=await readFile(file,'utf8');const batch=text.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
      if(batch.length!==m.records_count)throw new Error(`${table.name} 记录数量不一致。`);
      records.push(...batch);
      if(!m.has_more){complete=true;break;}
      if(!Number.isInteger(m.next_offset)||m.next_offset<=offset)throw new Error(`${table.name} 分页游标无效。`);offset=m.next_offset;
    }
    if(!complete || new Set(records.map(r=>r.record_id)).size!==records.length)throw new Error(`${table.name} 未完整读取或出现重复记录，旧快照已保留。`);
    onProgress({done:++done,total:7,table:table.name});
    return [table.key,{id:table.id,name:table.name,rev,fields,records,projectedFields:projected.map(f=>f.id),complete:true}];
  });
  const snapshot={version:1,syncedAt:new Date().toISOString(),baseUrl:parsed.baseUrl,tables:Object.fromEntries(result)};
  await atomicJson(join(dataDir,'snapshot.json'),snapshot);return snapshot;
}
export function fieldValueEqual(a,b) {
  if((a==null || Array.isArray(a)&&!a.length) && (b==null || Array.isArray(b)&&!b.length))return true;
  const normalize=x=>typeof x==='string'?x.replace(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g,'$1'):Array.isArray(x)?x.map(v=>typeof v==='object'?v.id:v).sort():x;
  return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}
export function validateFields(snapshot,key,values) {
  const table=snapshot.tables[key];if(!table || !EDIT_FIELDS[key])throw new Error('该表不支持编辑。');
  if(!values || Array.isArray(values)||typeof values!=='object')throw new Error('记录内容无效。');
  const entries=Object.entries(values);if(!entries.length)throw new Error('没有需要保存的改动。');
  const out={};
  for(const [name,value] of entries) {
    const f=table.fields.find(x=>x.name===name);
    if(!f || !EDIT_FIELDS[key].includes(name)||['formula','lookup','updated_at','created_at','attachment','user'].includes(f.type))throw new Error(`不可写字段：${name}`);
    if(value==null){out[name]=null;continue;}
    if(f.type==='text') {
      if(typeof value!=='string'||value.length>30000)throw new Error(`${name} 文本过长或无效。`);
      if(f.style?.type==='url' && value && !/^https?:\/\//i.test(value))throw new Error(`${name} 需要 HTTP(S) 链接；未知信息请留空。`);
    }else if(f.type==='select') {
      if(!Array.isArray(value)||!value.every(v=>f.options.some(o=>o.name===v))||!f.multiple&&value.length>1)throw new Error(`${name} 包含无效选项。`);
    }else if(f.type==='link') {
      const target=Object.values(snapshot.tables).find(t=>t.id===f.link_table);
      if(!Array.isArray(value)||!target||!value.every(v=>v && Object.keys(v).length===1 && target.records.some(r=>r.record_id===v.id)))throw new Error(`${name} 的关联记录无效。`);
    }else if(f.type==='number') {if(typeof value!=='number'||!Number.isFinite(value)||name==='预计金额'&&value<0)throw new Error(`${name} 数字无效。`);
    }else if(f.type==='datetime') {if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error(`${name} 日期无效。`);
    }else if(f.type==='checkbox') {if(typeof value!=='boolean')throw new Error(`${name} 值无效。`);
    }else throw new Error(`暂不支持此字段：${name}`);
    out[name]=value;
  }
  return out;
}
export async function writeRecord(snapshot, {key,recordId,values,expected}, {root,dataDir,run=runLark}) {
  const table=snapshot.tables[key];const parsed=parseBaseUrl(snapshot.baseUrl);
  const safe=validateFields(snapshot,key,values);
  if(key==='activities'){
    const current=recordId?table.records.find(r=>r.record_id===recordId)||{}:{};
    const merged={...current,...safe};const companies=ids(merged['对应公司']);
    const contacts=ids(merged['对应联系人']);
    if(contacts.length&&(!companies.length||contacts.some(id=>!snapshot.tables.contacts.records.some(r=>r.record_id===id&&ids(r['所属公司']).some(c=>companies.includes(c))))))throw new Error('任务联系人必须关联所选公司。请先核对联系人所属公司。');
  }
  const titles={accounts:'公司名称',contacts:'姓名',activities:'活动名称',opportunities:'商机名称',intelligence:'情报标题'};
  if(!recordId && !(safe[titles[key]]||'').trim())throw new Error('请填写名称或标题。');
  if(!recordId){
    let rows=realRows(table);const normalize=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
    // Recheck current remote rows so an older screen cannot silently add a duplicate.
    const duplicateFields={accounts:['公司名称'],contacts:['姓名','所属公司'],intelligence:['来源链接']}[key];
    if(duplicateFields){
      const live=[];let offset=0,rev,complete=false;
      for(let page=0;page<50;page++){
        const file=join(dataDir,`dedupe-${randomUUID()}.ndjson`);
        const args=['+record-list','--base-token',parsed.baseToken,'--table-id',table.id,'--offset',String(offset),'--limit','2000','--format','ndjson','--output',relative(root,file)];
        for(const name of duplicateFields)args.push('--field-id',table.fields.find(f=>f.name===name).id);
        const result=await run(args,{cwd:root});const batch=(await readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(r=>JSON.parse(r));
        if(typeof result.has_more!=='boolean'||result.records_count!==batch.length||rev!==undefined&&rev!==result.rev)throw new Error('新增前未能完整核对现有记录，请同步后再试。');
        rev=result.rev;live.push(...batch);if(!result.has_more){complete=true;break;}
        if(!Number.isInteger(result.next_offset)||result.next_offset<=offset)break;offset=result.next_offset;
      }
      if(!complete||new Set(live.map(r=>r.record_id)).size!==live.length)throw new Error('新增前的重复核对未完成，请稍后重试。');
      rows=live;
    }
    if(key==='accounts'&&rows.some(r=>normalize(r['公司名称'])===normalize(safe['公司名称'])))throw new Error('已有同名公司，请先核对已有记录，避免重复新增。');
    if(key==='contacts'&&rows.some(r=>normalize(r['姓名'])===normalize(safe['姓名'])&&ids(r['所属公司']).some(id=>ids(safe['所属公司']).includes(id))))throw new Error('该公司已有同名联系人，请核对现有记录。');
    if(key==='intelligence'&&safe['来源链接']&&rows.some(r=>canonicalUrl(r['来源链接'])===canonicalUrl(safe['来源链接'])))throw new Error('该来源已收录，请先检查现有情报，避免重复新增。');
  }
  if(recordId) {
    if(!table.records.some(r=>r.record_id===recordId))throw new Error('未找到目标记录。');
    if(!expected || Object.keys(safe).some(k=>!Object.hasOwn(expected,k)))throw new Error('缺少原字段值，请刷新后再修改。');
    const file=join(dataDir,`compare-${randomUUID()}.ndjson`);
    const args=['+record-get','--base-token',parsed.baseToken,'--table-id',table.id,'--record-id',recordId,'--format','ndjson','--output',relative(root,file)];
    for(const k of Object.keys(safe))args.push('--field-id',table.fields.find(f=>f.name===k).id);
    await run(args,{cwd:root});
    const current=JSON.parse((await readFile(file,'utf8')).trim().split('\n')[0]);
    if(Object.keys(safe).some(k=>!fieldValueEqual(expected[k],current[k])))throw new Error('这些字段已在飞书被修改。请同步数据、核对后重新保存，避免覆盖他人的更新。');
  }
  const payload=recordId?{update_records:{[recordId]:safe}}:{create_records:[safe]};
  const path=join(dataDir,`write-${randomUUID()}.json`);await atomicJson(path,payload);
  const args=[recordId?'+record-batch-update':'+record-batch-create','--base-token',parsed.baseToken,'--table-id',table.id,'--json','@'+relative(root,path)];
  const dry=await run([...args,'--dry-run'],{cwd:root});if(!dry.ok)throw new Error('飞书写入预检查失败。');
  const result=await run(args,{cwd:root});
  if(!result.ok||!Array.isArray(result.data?.record_id_list)||result.data.record_id_list.length!==1)throw new Error('无法确认写入结果，请先同步核查，勿重复提交。');
  if(result.data?.ignored_fields?.length)throw new Error('飞书忽略了部分字段，请同步后核对。');
  const savedId=result.data.record_id_list[0];
  const verifyFile=join(dataDir,`verify-${randomUUID()}.ndjson`);
  const verifyArgs=['+record-get','--base-token',parsed.baseToken,'--table-id',table.id,'--record-id',savedId,'--format','ndjson','--output',relative(root,verifyFile)];
  for(const k of Object.keys(safe))verifyArgs.push('--field-id',table.fields.find(f=>f.name===k).id);
  await run(verifyArgs,{cwd:root});
  const verified=JSON.parse((await readFile(verifyFile,'utf8')).trim().split('\n')[0]);
  if(Object.keys(safe).some(k=>!fieldValueEqual(safe[k],verified[k])))throw new Error(`飞书返回写入成功，但读回内容不一致（${savedId}）。请先同步核对，勿重复新增。`);
  return {recordId:savedId,rev:result.data.rev,verified:true};
}
