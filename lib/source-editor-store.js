import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {compileSourceRecord,normalizeSourceRecord} from './source-record.js';
import {sourceEditDiagnostics} from './source-edit-diagnostics.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>JSON.stringify(value,null,2)+'\n';
const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,100}$/.test(id);
const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function atomicWrite(file,text){
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temp,file);}finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function createSourceEditorStore({catalog,directory=path.resolve(import.meta.dirname,'../.local/source-records'),fault=()=>{}}){
 fs.mkdirSync(directory,{recursive:true});
 const paths=id=>{if(!validId(id))throw error('INVALID_CASE','案例标识无效');return {config:path.join(directory,id+'.json'),folder:path.join(directory,id),caseFile:path.join(catalog.directory,id+'.json')};};
 const config=id=>{const p=paths(id);if(!fs.existsSync(p.config))throw error('SOURCE_NOT_REGISTERED','此案例尚未登记可编辑的原始牌谱');const c=json(p.config);if(!path.isAbsolute(c.recordPath))throw error('SOURCE_NOT_REGISTERED','原始牌谱路径未正确登记');return {...p,...c};};
 const archive=(id,c,record)=>{const p=paths(id);const file=path.join(p.folder,'versions',c.hash+'.json');if(fs.existsSync(file))return;atomicWrite(file,bytes({case:{...c,hash:undefined},record,hash:c.hash}));};
 // A journal chooses a complete old/new generation from the installed case.
 // Recovery only touches bytes owned by this transaction; unrelated edits win.
 function recover(id){
  const p=paths(id),journal=path.join(p.folder,'pending.json');if(!fs.existsSync(journal))return;
  const tx=json(journal);const current=fs.existsSync(tx.sourceFile)?read(tx.sourceFile):'';
  if(current!==tx.oldSource&&current!==tx.newSource)throw error('RECOVERY_CONFLICT','发现中断提交和外部修改，已保留双方数据，请先检查恢复记录',409);
  const published=fs.existsSync(p.caseFile)&&hash(read(p.caseFile))===hash(tx.newCase);
  atomicWrite(tx.sourceFile,published?tx.newSource:tx.oldSource);
  atomicWrite(p.caseFile,published?tx.newCase:tx.oldCase);if(!published){const pendingArchive=path.join(p.folder,'versions',hash(tx.newCase)+'.json');if(fs.existsSync(pendingArchive))fs.unlinkSync(pendingArchive);}fs.unlinkSync(journal);
 }
 for(const name of fs.readdirSync(directory))if(name.endsWith('.json')&&validId(name.slice(0,-5)))recover(name.slice(0,-5));
 function current(id){const cfg=config(id);recover(id);catalog.reload(id);return {cfg,c:catalog.get(id),disk:read(cfg.recordPath)};}
 const draftPath=(id,clientId)=>{if(typeof clientId!=='string'||clientId.length<8||clientId.length>128)throw error('INVALID_CLIENT','编辑窗口标识无效');return path.join(paths(id).folder,'drafts',hash(clientId)+'.json');};
 function versions(id){const folder=path.join(paths(id).folder,'versions');if(!fs.existsSync(folder))return [];return fs.readdirSync(folder).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>{const v=json(path.join(folder,n));return {hash:v.hash,version:v.record?.version??0,at:v.case.editMeta?.at??null,reason:v.case.editMeta?.reason??'编辑前版本',changes:v.case.editMeta?.changes??[]};}).sort((a,b)=>b.version-a.version);}
 function get(id,clientId){
  const {cfg,c,disk}=current(id);let record=c.record;
  if(!record){record=normalizeSourceRecord(JSON.parse(disk));archive(id,c,record);}
  const dp=draftPath(id,clientId);
  return {caseId:id,record,sourcePath:cfg.recordPath,baseHash:c.hash,diskHash:c.editMeta?.sourceFileHash??hash(disk),currentDiskHash:hash(disk),externalChanged:c.editMeta?.sourceFileHash?hash(disk)!==c.editMeta.sourceFileHash:false,draft:fs.existsSync(dp)&&(JSON.stringify(json(dp).record)!==JSON.stringify(record)||json(dp).reason&&json(dp).reason!=='纠正牌谱')?json(dp):null,versions:versions(id),hasVideo:!!cfg.videoPath};
 }
 function saveDraft({caseId,clientId,record,baseHash,diskHash,selection,reason}){
  config(caseId);const draft={record,baseHash,diskHash,selection,reason:String(reason??'纠正牌谱').slice(0,500),at:new Date().toISOString()};atomicWrite(draftPath(caseId,clientId),bytes(draft));return {saved:true,at:draft.at};
 }
 function reread(caseId){const {disk}=current(caseId);return {record:normalizeSourceRecord(JSON.parse(disk)),diskHash:hash(disk)};}
 function validate(caseId,record,baseHash){const c=catalog.get(caseId,baseHash),result=compileSourceRecord(record,{gameId:c.data.gameId});return {...result,diagnostics:sourceEditDiagnostics(c,result)};}
 function differences(before,after){
  const rows=[];for(const field of new Set([...Object.keys(before),...Object.keys(after)]))if(!['events','version','verification','settlement','settlementBySeat','unplayedWall','revisionHistory'].includes(field)&&JSON.stringify(before[field])!==JSON.stringify(after[field]))rows.push({field,before:before[field],after:after[field]});
  const a=new Map(before.events.map(e=>[e.id,e])),b=new Map(after.events.map(e=>[e.id,e]));
  for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id)))rows.push({field:'events',eventId:id,before:a.get(id)??null,after:b.get(id)??null});return rows;
 }
 function commit({caseId,clientId,record,baseHash,diskHash,operationId,reason='纠正牌谱'}){
  if(typeof operationId!=='string'||!/^[\w-]{8,100}$/.test(operationId))throw error('INVALID_OPERATION','保存请求标识无效');
  const {cfg,c,disk}=current(caseId);
  if(c.editMeta?.operationId===operationId)return {saved:true,hash:c.hash,version:c.record.version};
  if(c.hash!==baseHash||hash(disk)!==diskHash)throw error('SOURCE_EDIT_CONFLICT','原谱已被其他窗口或外部文件修改。草稿已保留，请重新读取并比较后保存。',409);
  const normalized=normalizeSourceRecord(record);if(normalized.caseId!==caseId)throw error('INVALID_CASE','不能在编辑中更换案例标识');
  normalized.version=(c.record?.version??JSON.parse(disk).version??0)+1;
  const result=validate(caseId,normalized);if(!result.ok)return {...result,saved:false};
  const oldRecord=normalizeSourceRecord(c.record??JSON.parse(disk));
  const newSource=bytes(result.record),changes=differences(oldRecord,result.record);
  const next={...c,hash:undefined,record:result.record,data:result.data,recordVersion:result.record.version,lessons:[],analysisStatus:'needs-review',
   notice:`历史回放 · 牌谱 v${result.record.version}；数据校验通过，视频核对未完成；旧讲解待复核，尾墙顺序未核实。`,
   editMeta:{operationId,sourceFileHash:hash(newSource),at:new Date().toISOString(),reason:String(reason).slice(0,500),changes}};
  next.keyIndex=Math.min(next.keyIndex??0,next.data.snapshots.length-1);
  const oldCase=read(cfg.caseFile),newCase=bytes(next);archive(caseId,c,oldRecord);
  const newHash=hash(newCase);archive(caseId,{...next,hash:newHash},result.record);
  const journal=path.join(cfg.folder,'pending.json');atomicWrite(journal,bytes({sourceFile:cfg.recordPath,oldSource:disk,newSource,oldCase,newCase}));
  try{fault('beforeSource');atomicWrite(cfg.recordPath,newSource);fault('beforeCase');atomicWrite(cfg.caseFile,newCase);fault('afterCase');fs.unlinkSync(journal);}
  catch(e){recover(caseId);catalog.reload(caseId);if(catalog.get(caseId).hash!==newHash)throw error('SAVE_FAILED','保存失败，原可用版本和草稿均已保留。原因：'+e.message,500);}
  catalog.reload(caseId);const dp=draftPath(caseId,clientId);if(fs.existsSync(dp))fs.unlinkSync(dp);
  return {saved:true,hash:newHash,version:result.record.version,changes,warnings:result.warnings};
 }
 function historical(caseId,versionHash){if(typeof versionHash!=='string'||!/^[a-f0-9]{64}$/.test(versionHash))throw error('INVALID_VERSION','版本标识无效');return json(path.join(paths(caseId).folder,'versions',versionHash+'.json'));}
 function restore(args){const old=historical(args.caseId,args.restoreHash);return commit({...args,record:old.record,reason:`恢复至牌谱 v${old.record.version}`});}
 return {get,saveDraft,reread,validate,commit,restore,versions,historical,config,available:id=>fs.existsSync(paths(id).config)};
}
