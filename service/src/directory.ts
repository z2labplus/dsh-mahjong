import { COACH_LESSONS } from './coach-lessons';
import { DurableObject } from 'cloudflare:workers';
import { bearer, errorResponse, issueAccess, json, readJson, ServiceError, verifyAccess, type Access } from './auth';

type User = {owner:string; active:boolean; epoch:number; maxTables:number; maxActive:number; createdAt:number};
type Row = {gameId:string; owner:string; tableName:string; ruleset:string; phase:string; mode:string; createdAt:number; imported?:boolean};
export interface DirectoryEnv { SERVICE_SECRET:string }
export class MahjongDirectory extends DurableObject<DirectoryEnv> {
  async fetch(request:Request):Promise<Response> {
    try {
      const url=new URL(request.url);
      if (url.hostname==='directory') {
        const input:any=await request.json();
        if (url.pathname==='/check') {await this.check(input);return json({ok:true});}
        if (url.pathname==='/reserve') {
          return await this.ctx.blockConcurrencyWhile(async()=>{
            try {
              const user=await this.check(input.access);
              const key=`table:${input.access.owner}:${input.row.gameId}`;
              const previous=await this.ctx.storage.get(key);
              if(!previous){
                const rows=await this.ctx.storage.list<Row>({prefix:`table:${user.owner}:`});
                if(rows.size>=user.maxTables)throw new ServiceError('HISTORY_QUOTA_REACHED',429);
                if(!input.row.imported && [...rows.values()].filter(r=>!['done','imported','deleted'].includes(r.phase)).length>=user.maxActive)throw new ServiceError('ACTIVE_TABLE_QUOTA_REACHED',429);
                await this.ctx.storage.put(key,{...input.row,owner:user.owner});
              }
              return json({ok:true});
            }catch(e){return errorResponse(e);}
          });
        }
        if(url.pathname==='/coach-result') {
          return await this.ctx.blockConcurrencyWhile(()=>this.ctx.storage.transaction(async t=>{
            if(!await t.get(`coach-result:${input.gameId}`)){
              const key=`coach:${input.owner}:${input.lessonId}`;
              const old=await t.get<any>(key)??{attempts:0,passed:false};
              await t.put(key,{attempts:old.attempts+1,passed:old.passed||input.status==='passed',lastAt:Date.now()});
              await t.put(`coach-result:${input.gameId}`,true);
            }
            return json({ok:true});
          }));
        }
        if(url.pathname==='/update') {
          const key=`table:${input.row.owner}:${input.row.gameId}`;
          const old=await this.ctx.storage.get<Row>(key);
          if(old)await this.ctx.storage.put(key,{...old,...input.row});
          return json({ok:true});
        }
        throw new ServiceError('NOT_FOUND',404);
      }
      if(url.pathname==='/v1/invitations/redeem' && request.method==='POST') {
        const input=await readJson(request);
        const invite=await verifyAccess(this.env.SERVICE_SECRET,input.invitation);
        if(invite.kind!=='owner'||invite.purpose!=='join'||!invite.jti)throw new ServiceError('INVALID_INVITATION');
        return await this.ctx.blockConcurrencyWhile(async()=>{
          try {
            const user=await this.ctx.storage.get<User>(`user:${invite.owner}`);
            if(!user?.active||user.epoch!==(invite.epoch??0)||await this.ctx.storage.get(`used:${invite.jti}`))throw new ServiceError('INVITATION_UNAVAILABLE',409);
            const token=await issueAccess(this.env.SERVICE_SECRET,{v:1,kind:'owner',tenant:invite.tenant,owner:invite.owner,epoch:user.epoch,exp:Date.now()+30*86400000});
            await this.ctx.storage.put(`used:${invite.jti}`,true);
            return json({ok:true,owner:invite.owner,ownerApiToken:token});
          }catch(e){return errorResponse(e);}
        });
      }
      const access=await verifyAccess(this.env.SERVICE_SECRET,bearer(request));
      if(access.kind!=='owner')throw new ServiceError('FORBIDDEN',403);
      await this.check(access);
      if(url.pathname==='/v1/coach/lessons' && request.method==='GET'){
        const progress=await this.ctx.storage.list({prefix:`coach:${access.owner}:`});
        return json({ok:true,lessons:COACH_LESSONS.map(({id,title,goal})=>({id,title,goal,progress:progress.get(`coach:${access.owner}:${id}`)??{attempts:0,passed:false}}))});
      }
      if(url.pathname==='/v1/library' && request.method==='GET') {
        const rows=await this.ctx.storage.list<Row>({prefix:`table:${access.owner}:`});
        return json({ok:true,items:[...rows.values()].sort((a,b)=>b.createdAt-a.createdAt)});
      }
      if(url.pathname!=='/v1/admin/users'||!access.admin)throw new ServiceError('FORBIDDEN',403);
      if(request.method==='GET')return json({ok:true,users:[...(await this.ctx.storage.list<User>({prefix:'user:'})).values()]});
      if(request.method!=='POST')throw new ServiceError('METHOD_NOT_ALLOWED',405);
      const input=await readJson(request);
      return await this.ctx.blockConcurrencyWhile(async()=>{try{
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(input.owner??''))throw new ServiceError('INVALID_USER');
      let user=await this.ctx.storage.get<User>(`user:${input.owner}`);
      if(!user)user={owner:input.owner,active:true,epoch:0,maxTables:50,maxActive:4,createdAt:Date.now()};
      if(input.operation==='revoke') {if(input.owner===access.owner)throw new ServiceError('ADMIN_SELF_REVOKE');user.active=false;user.epoch++;}
      else if(input.operation==='invite') {user.active=true;}
      else if(input.operation!=='quota')throw new ServiceError('INVALID_USER_OPERATION');
      for(const key of ['maxTables','maxActive'] as const)if(input[key]!==undefined){if(!Number.isInteger(input[key])||input[key]<1||input[key]>500)throw new ServiceError('INVALID_QUOTA');user[key]=input[key];}
      await this.ctx.storage.put(`user:${input.owner}`,user);
      const invitation=input.operation==='invite'?await issueAccess(this.env.SERVICE_SECRET,{v:1,kind:'owner',tenant:access.tenant,owner:user.owner,epoch:user.epoch,purpose:'join',jti:crypto.randomUUID(),exp:Date.now()+86400000}):undefined;
      return json({ok:true,user,...(invitation?{invitation}:{})});
      }catch(error){return errorResponse(error);}});
    }catch(error){return errorResponse(error);}
  }
  private async check(access:Access):Promise<User> {
    if(access.purpose==='join')throw new ServiceError('INVITATION_NOT_REDEEMED',403);
    const key=`user:${access.owner}`;
    let user=await this.ctx.storage.get<User>(key);
    // Signed bootstrap owner tokens are issued on the administrator's machine.
    if(!user){user={owner:access.owner,active:true,epoch:access.epoch??0,maxTables:50,maxActive:4,createdAt:Date.now()};await this.ctx.storage.put(key,user);}
    if(!user.active||user.epoch!==(access.epoch??0))throw new ServiceError('USER_REVOKED',403);
    return user;
  }
}
