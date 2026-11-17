import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readJson, syncBase } from '../lib/feishu.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));const dataDir=join(root,'.data');
await mkdir(dataDir,{recursive:true,mode:0o700});
const config=await readJson(join(dataDir,'config.json'),{baseUrl:process.env.FEISHU_BASE_URL||''});
const s=await syncBase(config,{root,dataDir,onProgress:p=>console.log(`${p.done}/${p.total} ${p.table}`)});
console.log(JSON.stringify({syncedAt:s.syncedAt,counts:Object.fromEntries(Object.entries(s.tables).map(([k,t])=>[k,t.records.length]))}));
