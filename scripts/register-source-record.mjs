import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite} from '../lib/source-editor-store.js';
import {normalizeSourceRecord,compileSourceRecord} from '../lib/source-record.js';
const [recordFile,videoFile]=process.argv.slice(2);
if(!recordFile)throw new Error('用法：node scripts/register-source-record.mjs 原谱.json [本地视频.mp4]');
const recordPath=fs.realpathSync(recordFile),bytes=fs.readFileSync(recordPath,'utf8'),r=normalizeSourceRecord(JSON.parse(bytes));
if(!/^[a-z0-9-]{1,100}$/.test(r.caseId))throw new Error('案例标识无效');
const root=path.resolve(import.meta.dirname,'../.local/source-records'),config=path.join(root,r.caseId+'.json');fs.mkdirSync(root,{recursive:true});
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.json'))){const c=JSON.parse(fs.readFileSync(path.join(root,file)));if(fs.realpathSync(c.recordPath)===recordPath&&file!==r.caseId+'.json')throw new Error('这个原谱已在其他案例登记');}
if(fs.existsSync(config)&&JSON.parse(fs.readFileSync(config)).recordPath!==recordPath)throw new Error('案例已登记不同原谱，拒绝覆盖');
const caseFile=path.resolve(root,'../cases',r.caseId+'.json');
const old=fs.existsSync(caseFile)?fs.readFileSync(caseFile,'utf8'):null,c=old?JSON.parse(old):null;
if(c&&!c.record){r.timing={dealt:c.data.snapshots[0].at,exchanged:c.data.snapshots[1].at,dingque:c.data.snapshots[2].at,settlement:c.data.snapshots.at(-1).at};}
const result=compileSourceRecord(r,{gameId:c?.data.gameId});if(!result.ok)throw new Error(JSON.stringify(result.issues));
const hash=x=>createHash('sha256').update(x).digest('hex');
if(c&&!c.record){
 const archive=path.join(root,r.caseId,'versions',hash(old)+'.json');
 if(!fs.existsSync(archive))atomicWrite(archive,JSON.stringify({hash:hash(old),case:c,record:r},null,2)+'\n');
 // Retain the original replay frames during registration. Regeneration happens on editor commit.
 const baseline={...c,record:r,recordVersion:r.version,editMeta:{sourceFileHash:hash(bytes),reason:'登记原谱',at:new Date().toISOString(),changes:[]}};
 atomicWrite(caseFile,JSON.stringify(baseline,null,2)+'\n');
}else if(!c){
 const created={schema:'dsh-mahjong.source-case.v1',caseId:r.caseId,title:r.title,keyIndex:0,keySeat:r.dealer,lessons:[],record:result.record,recordVersion:r.version,data:result.data,notice:'数据校验通过；视频核对、赛事完整计分规则及尾墙顺序未核实。',editMeta:{sourceFileHash:hash(bytes),reason:'登记原谱',at:new Date().toISOString(),changes:[]}};
 atomicWrite(caseFile,JSON.stringify(created,null,2)+'\n');
}
const previous=fs.existsSync(config)?JSON.parse(fs.readFileSync(config)):{};
atomicWrite(config,JSON.stringify({...previous,recordPath,...(videoFile?{videoPath:fs.realpathSync(videoFile)}:{})},null,2)+'\n');
console.log('已登记原谱：'+r.caseId+'。原始文件保留原位置。');
