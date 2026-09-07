#!/usr/bin/env node
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,unlinkSync,symlinkSync,openSync,closeSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {createInterface} from 'node:readline/promises';
import {serviceFetch,isLoopback} from '../lib/service-network.js';
import {normalizeServiceUrl} from '../lib/service-control.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=path.join(root,'.local');
const profileName='dsh-mahjong-standalone';
const harnessRoot=path.resolve(process.env.DSH_HARNESS_ROOT??path.join(root,'..','DeepSeekHarness'));
const sourceHome=path.resolve(process.env.DSH_HOME??path.join(harnessRoot,'dsh-home'));
const savedConnection=existsSync(path.join(local,'connection.json'))?JSON.parse(readFileSync(path.join(local,'connection.json'),'utf8')):null;
const identity=savedConnection?(savedConnection.owner??JSON.parse(Buffer.from(savedConnection.ownerApiToken.split('.')[1],'base64url')).owner):null;
const homeName=savedConnection?'harness-'+createHash('sha256').update(savedConnection.url+'|'+identity).digest('hex').slice(0,16):'harness-home';
const dshHome=path.resolve(process.env.DSH_MAHJONG_HOME??path.join(local,homeName));
const harnessBin=path.join(harnessRoot,'app','node_modules','@deepseek-ai','dsh','lib','bin.js');
function port(value,fallback){const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<1024||n>65535)throw new Error('端口必须是 1024–65535 之间的整数。');return n;}
export const PORTS={service:port(process.env.DSH_MAHJONG_SERVICE_PORT,8787),harness:port(process.env.DSH_MAHJONG_PORT,3082)};
export function parseCommand(argv){const cmd=argv[0]??'start';if(!['start','stop','status','install','connect'].includes(cmd)||argv.length>(cmd==='connect'?2:1))throw new Error('用法：local-test-stack.mjs [install|start|stop|status|connect <服务网址>]');return cmd;}
export function ownerToken(secret,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({v:1,kind:'owner',tenant:'local',owner:'administrator',admin:true,exp:now+30*86400000})).toString('base64url');
 return `dsh1.${payload}.${createHmac('sha256',secret).update(`dsh1.${payload}`).digest('base64url')}`;
}
export function isExpectedProcessCommand(command,fingerprint){return typeof command==='string'&&typeof fingerprint==='string'&&fingerprint.length>8&&command.includes(fingerprint);}
function secureWrite(file,value){mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temp,file);}
function read(file){return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;}
function running(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function listening(port){return new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1');socket.setTimeout(800);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});}
export async function waitReady(url,{timeoutMs=90000,requestTimeoutMs=3000,pollMs=500,label='本地牌局服务',logPath=path.join(local,'service.log'),fetchImpl=serviceFetch}={}){
 const end=Date.now()+timeoutMs;let failure='未响应';
 while(Date.now()<end){
  try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(Math.max(1,Math.min(requestTimeoutMs,end-Date.now())))});await response.body?.cancel();if(response.ok)return;failure=`HTTP ${response.status}`;}
  catch(error){const code=error.cause?.code??error.code;failure=error.name==='TimeoutError'?'网络连接超时':typeof code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(code)?code:'网络请求失败';}
  if(Date.now()<end)await new Promise(r=>setTimeout(r,Math.min(pollMs,end-Date.now())));
 }
 const guidance=isLoopback(url)?`请查看日志：${logPath}`:'请检查网络及代理是否可用；终端代理环境变量优先，未设置时会读取 macOS 系统 HTTP/HTTPS 代理。';
 throw new Error(`${label}连接失败（${failure}）。${guidance}`);
}
function run(args,cwd=root){const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd,stdio:'inherit'});if(result.status!==0)throw new Error('依赖安装或构建失败。');}
function localSecret(){
 const file=path.join(root,'service','.dev.vars');
 if(!existsSync(file))writeFileSync(file,`SERVICE_SECRET=${randomBytes(48).toString('hex')}\n`,{mode:0o600});
 const match=readFileSync(file,'utf8').match(/^SERVICE_SECRET\s*=\s*["']?([^\r\n"']+)/m);
 if(!match||match[1].length<32)throw new Error('本地服务签名配置无效。');return match[1].trim();
}
async function install(){
 if(!existsSync(harnessBin))throw new Error('未找到官方 DeepSeek Harness。请先安装，或设置 DSH_HARNESS_ROOT。');
 mkdirSync(local,{recursive:true,mode:0o700});
 run(['install','--ignore-scripts','--legacy-peer-deps']);
 const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 for(const name of Object.keys(pkg.peerDependencies)){
  const source=path.join(harnessRoot,'app','node_modules',name),target=path.join(root,'node_modules',name);
  if(!existsSync(source))throw new Error(`官方 Harness 缺少依赖 ${name}`);
  if(!existsSync(target)){mkdirSync(path.dirname(target),{recursive:true});symlinkSync(source,target,'dir');}
 }
 run(['ci'],path.join(root,'frontend'));run(['ci'],path.join(root,'service'));
 run(['--prefix','service','run','build']);
 if(existsSync(path.join(local,'uninstalled.json')))unlinkSync(path.join(local,'uninstalled.json'));
 console.log('独立牌桌、牌局服务与 Harness 插件已安装。');
}
function setupProfile(origin){
 mkdirSync(dshHome,{recursive:true,mode:0o700});
 for(const name of ['settings.yaml','.credentials.yaml']) {
  const source=path.join(sourceHome,name),target=path.join(dshHome,name);
  if(source!==target&&existsSync(source)&&!existsSync(target)){copyFileSync(source,target);chmodSync(target,0o600);}
 }

 const profile=path.join(dshHome,'profiles',profileName);mkdirSync(path.join(profile,'node_modules'),{recursive:true});
 const manifest={name:'dsh-profile-mahjong-standalone',private:true,dependencies:{'dsh-mahjong':`file:${root}`},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-mahjong']}}};
 secureWrite(path.join(profile,'package.json'),manifest);
 writeFileSync(path.join(profile,'cordis.yml'),'[]\n');
 writeFileSync(path.join(profile,'cordis.patch.yml'),`- id: dsh-mahjong\n  config:\n    service:\n      url: ${JSON.stringify(origin)}\n      tokenEnv: DSH_MAHJONG_SERVICE_TOKEN\n      handUrlBase: ${JSON.stringify(origin+'/hand/')}\n`);
 const target=path.join(profile,'node_modules','dsh-mahjong');if(!existsSync(target))symlinkSync(root,target,'dir');
}
function detach(role,args,cwd,env,fingerprint){
 const log=openSync(path.join(local,role+'.log'),'a',0o600);
 const child=spawn(process.execPath,args,{cwd,env,detached:true,stdio:['ignore',log,log]});child.unref();closeSync(log);
 return {role,pid:child.pid,fingerprint};
}
async function start(){
 if(existsSync(path.join(local,'uninstalled.json')))throw new Error('麻将插件已卸载。若要重新安装，请先运行 npm run setup。');
 mkdirSync(local,{recursive:true,mode:0o700});
 const state=read(path.join(local,'processes.json'));
 if(state?.processes?.some(p=>running(p.pid)))throw new Error('已有受管理进程，请先查看 status 或停止后再启动。');
 if(!existsSync(harnessBin)||!existsSync(path.join(root,'service','dist','worker.js')))throw new Error('请先运行 install 完成安装和构建。');
 const remote=read(path.join(local,'connection.json'));
 const origin=remote?normalizeServiceUrl(remote.url):`http://127.0.0.1:${PORTS.service}`;
 if(await listening(PORTS.harness)||(!remote&&await listening(PORTS.service)))throw new Error('所需端口已被其他进程占用，没有关闭现有服务。');
 const token=remote?.ownerApiToken??ownerToken(localSecret());
 setupProfile(origin);
 const processes=[];
 if(!remote){
  const wrangler=path.join(root,'service','node_modules','wrangler','bin','wrangler.js');
  processes.push(detach('service',[wrangler,'dev','--ip','127.0.0.1','--port',String(PORTS.service)],path.join(root,'service'),process.env,wrangler));
 }
 secureWrite(path.join(local,'processes.json'),{processes});
 try{
  console.log(remote?'正在连接 Cloudflare 牌局服务…':'正在启动本地牌局服务…');
  await waitReady(origin+'/health',remote?{timeoutMs:20000,requestTimeoutMs:8000,label:'Cloudflare 牌局服务'}:{});
  console.log('正在启动本地 Harness…');
  processes.push(detach('harness',[harnessBin,'--profile',profileName,'--host','127.0.0.1','--port',String(PORTS.harness),'--no-open'],root,{...process.env,DSH_HOME:dshHome,DSH_TELEMETRY_MODE:'DISABLED',DSH_MAHJONG_SERVICE_TOKEN:token,CHOKIDAR_USEPOLLING:'1',CHOKIDAR_INTERVAL:'1000'},`--profile ${profileName}`));
  secureWrite(path.join(local,'processes.json'),{processes});
  await waitReady(`http://127.0.0.1:${PORTS.harness}/`,{timeoutMs:180000,label:'本地 Harness',logPath:path.join(local,'harness.log')});
  console.log(`已启动：http://127.0.0.1:${PORTS.harness}/`);
 }catch(error){await stop();throw error;}
}
async function stop(){
 const file=path.join(local,'processes.json'),state=read(file);if(!state){console.log('没有受管理进程。');return;}
 const keep=[];
 for(const item of [...state.processes].reverse()){
  if(!running(item.pid))continue;
  const result=spawnSync('ps',['-p',String(item.pid),'-o','command='],{encoding:'utf8'});
  if(!isExpectedProcessCommand(result.stdout,item.fingerprint)){keep.push(item);continue;}
  try{process.kill(-item.pid,'SIGTERM');}catch{try{process.kill(item.pid,'SIGTERM');}catch{}}
  const until=Date.now()+8000;while(running(item.pid)&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
  if(running(item.pid))keep.push(item);
 }
 secureWrite(file,{processes:keep});console.log(keep.length?'有进程未能安全停止，请查看状态。':'本启动器管理的进程已停止。');
}
async function connect(origin){
 origin=normalizeServiceUrl(origin);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  const invitation=(await rl.question('请输入管理员交给你的一次性邀请：')).trim();
  const response=await serviceFetch(origin+'/v1/invitations/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok||!result.ownerApiToken)throw new Error('邀请领取失败，可能已使用、过期或被撤销。');
  secureWrite(path.join(local,'connection.json'),{url:origin,owner:result.owner,ownerApiToken:result.ownerApiToken});
  console.log('服务已连接，凭证仅保存在本地私有文件。停止旧进程后重新 start 即可。');
 }finally{rl.close();}
}
async function main(){
 const command=parseCommand(process.argv.slice(2));
 if(command==='install')await install();
 if(command==='start')await start();
 if(command==='stop')await stop();
 if(command==='connect')await connect(process.argv[3]);
 if(command==='status'){const state=read(path.join(local,'processes.json'));console.log(JSON.stringify({service:await listening(PORTS.service),harness:await listening(PORTS.harness),managed:state?.processes?.map(p=>({role:p.role,running:running(p.pid)}))??[]},null,2));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
