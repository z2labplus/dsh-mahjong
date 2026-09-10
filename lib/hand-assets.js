import {createReadStream} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import path from 'node:path';
export const HAND_ASSET_PREFIX='/dsh-mahjong/view/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.otf':'font/otf','.woff2':'font/woff2'};
export function createHandAssetsHandler(directory=path.resolve(import.meta.dirname,'../frontend/.dsh-build')){
 return async(req,res)=>{try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const u=new URL(req.url,'http://localhost');if(!u.pathname.startsWith(HAND_ASSET_PREFIX)){res.writeHead(404).end();return;}
  let relative=decodeURIComponent(u.pathname.slice(HAND_ASSET_PREFIX.length));if(relative==='hand/'||relative==='hand')relative='index.html';
  const file=path.resolve(directory,relative);if(!file.startsWith(directory+path.sep)||!types[path.extname(file).toLowerCase()]){res.writeHead(404).end();return;}
  const actual=await realpath(file),base=await realpath(directory);if(!actual.startsWith(base+path.sep)){res.writeHead(404).end();return;}
  const info=await stat(actual);if(!info.isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()],'Content-Length':info.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'no-referrer'});
  if(req.method==='HEAD')res.end();else createReadStream(actual).on('error',()=>res.destroy()).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404).end('牌桌资源尚未构建');else res.destroy();}};
}
