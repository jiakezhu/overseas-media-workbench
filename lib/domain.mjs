export const one=v=>Array.isArray(v)?String(v[0]??''):typeof v==='string'?v:'';
export const list=v=>Array.isArray(v)?v:[];
export const cell=v=>v==null?'':Array.isArray(v)?v.map(x=>typeof x==='object'?(x.name||x.id||''):x).join('、'):String(v);
export const ids=v=>list(v).map(x=>x.id).filter(Boolean);
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function urls(text) {
  const values=String(text||'').match(/https?:\/\/[^\s<>"\]]+/g)||[];
  return [...new Set(values.map(s=>s.replace(/[)）,，。；;]+$/g,'')).filter(s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}))];
}
export const firstUrl=v=>urls(v)[0]||'';
export const realRows=t=>(t?.records||[]).filter(r=>!list(r['数据标记']).includes('样例/测试'));
export function canonicalUrl(value) {
  try{const u=new URL(firstUrl(value)||value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||['fbclid','gclid'].includes(k))u.searchParams.delete(k);u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');u.pathname=u.pathname.replace(/\/$/,'')||'/';return u.toString();}catch{return '';}
}
export function makeModel(snapshot,prefs={}) {
  if(!snapshot)return {accounts:[],contacts:[],intelligence:[],activities:[],opportunities:[],playbook:[],funnel:[],stats:{accounts:0,contacts:0,intelligence:0,tasks:0,opportunities:0,missingLinkedin:0},regions:[],tableLinks:{}};
  const rows=key=>realRows(snapshot.tables[key]);
  const accounts=rows('accounts').map(r=>({id:r.record_id,name:r['公司名称']||'未命名客户',country:one(r['国家'])||'待核实',region:one(r['所属大区'])||'待核实',type:cell(r['客户类型']),stage:one(r['当前开发阶段'])||'待研究',confidence:one(r['信息可信度'])||'待核实',priority:Number(r['评分已填项']||0)>0?(r['客户优先级']||'待评分'):'待评分',score:Number(r['评分已填项']||0)>0?Number(r['客户评分']):null,scoreStatus:one(r['评分状态'])||'未评分',contactIds:ids(r['关联联系人']),intelligenceIds:ids(r['关联情报']),website:firstUrl(r['官网']),pinned:(prefs.pinned||[]).includes(r.record_id),raw:r}));
  const byId=Object.fromEntries(accounts.map(a=>[a.id,a]));
  const names=ref=>ids(ref).map(id=>byId[id]?.name).filter(Boolean);
  const contacts=rows('contacts').map(r=>({id:r.record_id,name:r['姓名']||'姓名待核实',title:r['职位']||'职位待核实',companyIds:ids(r['所属公司']),companyNames:names(r['所属公司']),country:one(r['国家'])||'待核实',role:one(r['决策链角色'])||'Unknown',status:one(r['建联状态'])||'待确认',confidence:one(r['信息可信度'])||'待核实',linkedin:firstUrl(r['LinkedIn 个人主页']),raw:r}));
  const activities=rows('activities').map(r=>({id:r.record_id,title:r['活动名称']||'未命名任务',companyIds:ids(r['对应公司']),companyNames:names(r['对应公司']),status:one(r['任务状态'])||'待执行',date:r['活动日期']||'',nextDate:r['下次跟进日期']||'',intelligenceId:String(r['沟通内容摘要']||'').match(/【情报ID:([^】]+)】/)?.[1]||'',raw:r}));
  const intelligence=rows('intelligence').map(r=>({id:r.record_id,title:r['情报标题']||'未命名情报',category:one(r['情报类别'])||'其他',confidence:one(r['信息可信度'])||'待核实',companyIds:ids(r['关联客户']),companyNames:names(r['关联客户']),regions:list(r['国家/区域']),publishedAt:r['新闻发布日期']||'',eventAt:r['事件发生日期']||'',verifiedAt:r['最近核实日期']||'',fact:r['已确认事实']||'',hypothesis:r['潜在销售机会（分析假设）']||'',action:r['建议销售动作']||'',source:firstUrl(r['来源链接']),used:r['是否已用于建联']===true,taskIds:activities.filter(a=>a.intelligenceId===r.record_id).map(a=>a.id),raw:r}));
  const opportunities=rows('opportunities').map(r=>({id:r.record_id,title:r['商机名称'],companyIds:ids(r['客户公司']),companyNames:names(r['客户公司']),stage:one(r['商机阶段']),amount:r['预计金额']??null,currency:one(r['币种']),valid:String(r['是否有效商机'])==='1',raw:r}));
  const playbook=rows('playbook').map(r=>({id:r.record_id,title:r['话术名称'],channel:one(r['渠道']),stage:one(r['推进阶段']),scene:one(r['场景']),template:r['英文模板']||'',usage:r['使用说明']||'',limit:r['字数上限']??null,roles:list(r['适用角色']),raw:r}));
  const funnel=rows('funnel').map(r=>({id:r.record_id,order:r['序号'],stage:r['阶段'],count:Number(r['公司数']||0),definition:r['统计口径']})).sort((a,b)=>a.order-b.order);
  const regions=[...new Set(accounts.map(a=>a.region))].map(name=>({name,count:accounts.filter(a=>a.region===name).length})).sort((a,b)=>b.count-a.count);
  return {accounts,contacts,intelligence,activities,opportunities,playbook,funnel,regions,tableLinks:Object.fromEntries(Object.entries(snapshot.tables).map(([k,t])=>[k,`${snapshot.baseUrl}?table=${encodeURIComponent(t.id)}`])),stats:{accounts:accounts.length,contacts:contacts.length,intelligence:intelligence.length,tasks:activities.filter(t=>!['已完成','已取消'].includes(t.status)).length,opportunities:opportunities.length,missingLinkedin:contacts.filter(c=>!c.linkedin).length,verified:intelligence.filter(i=>i.confidence==='已验证').length,partial:intelligence.filter(i=>i.confidence==='部分验证').length,pending:intelligence.filter(i=>i.confidence==='待核实').length,converted:intelligence.filter(i=>i.taskIds.length).length,used:intelligence.filter(i=>i.used).length,unlinked:intelligence.filter(i=>!i.companyIds.length).length}};
}
export function reportForIntelligence(item,model) {
  const contacts=model.contacts.filter(c=>c.companyIds.some(id=>item.companyIds.includes(id)));
  return `# ${item.title}\n\n来源：${item.source||'待补充'}\n发布时间：${item.publishedAt||'待核实'}\nBase 可信度标记：${item.confidence}\n关联客户：${item.companyNames.join('、')||'待关联'}\n\n## 来源记录的事实\n\n${item.fact||'待核实，尚未填写。'}\n\n## 销售假设（需要验证）\n\n${item.hypothesis||'尚未形成。'}\n\n## 关键人\n\n${contacts.map(c=>`- ${c.name}｜${c.title}｜${c.confidence}｜${c.linkedin||'LinkedIn 待核实'}`).join('\n')||'待定位'}\n\n## 下一步候选动作\n\n${item.action||'核对原文、确认客户关联与负责该事项的人，再决定触达动作。'}\n\n采购意向、预算及采购权限需要实际确认；本简报不代表已触达或已形成有效商机。\n`;
}
