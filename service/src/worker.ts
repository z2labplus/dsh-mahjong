import { checkSessionAccess, readSession, sessionCookie } from './browser-session';
import { DurableObject } from 'cloudflare:workers';
import { bearer, errorResponse, issueAccess, json, readJson, ServiceError, validGameId, verifyAccess, type Access } from './auth';
import { normalizeTable, TableCore, type Checkpoint } from './table-core';
import {createChallengeCheckpoint} from './challenge';
import {challengeSummary} from './challenge-policy';
import {createCoachCheckpoint} from './coach';
import {coachLesson} from './coach-lessons';
import { MAX_HISTORY_FRAMES, practiceCheckpoint, projectFrame, validateArchive, type HistoryFrame } from './history';
export { MahjongDirectory } from './directory';

export interface Env { TABLES: DurableObjectNamespace; DIRECTORY: DurableObjectNamespace; SERVICE_SECRET: string; ASSETS?: Fetcher }
type Connection = { expiresAt: number; access?: Access; resumeAccess?: Access; bound?: boolean; decisionId?: string; rate?: {at:number;count:number} };
async function directory(env:Env,access:Access,path:string,body:any=access) {
  const response=await env.DIRECTORY.get(env.DIRECTORY.idFromName(access.tenant)).fetch(`https://directory${path}`,{method:'POST',body:JSON.stringify(body)});
  const value:any=await response.json();
  if(!response.ok)throw new ServiceError(value.errorCode,response.status);
  return value;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return json({ service: 'dsh-mahjong', version: 1, engine: ['blood','guobiao'], frontendReady: Boolean(env.ASSETS), features:['takeover-challenge-v1'] });
      if (path === '/manifest.webmanifest') return json({ name: 'dsh-mahjong', short_name: '麻将', start_url: '/hand/', display: 'standalone', background_color: '#0b0f14', theme_color: '#0b0f14' });
      if (!path.startsWith('/v1/') && env.ASSETS) return env.ASSETS.fetch(request);
      if(['/v1/library','/v1/admin/users','/v1/invitations/redeem','/v1/coach/lessons'].includes(path)) {
        const access=await verifyAccess(env.SERVICE_SECRET,path.endsWith('/redeem')?(await readJson(request.clone())).invitation:bearer(request));
        return env.DIRECTORY.get(env.DIRECTORY.idFromName(access.tenant)).fetch(request);
      }
      const share=/^\/v1\/shares\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/.exec(path);
      if(share && validGameId(share[1]) && validGameId(share[2]))return env.TABLES.get(env.TABLES.idFromName(share[1])).fetch(request);
      const match = /^\/v1\/tables\/([a-f0-9-]{36})(\/(?:challenge|coach|ws|session|history(?:\/\d+)?|replay|shares(?:\/[a-f0-9-]{36})?|practice|seats\/[0-3]\/revoke))?$/.exec(path);
      if (!match || !validGameId(match[1])) throw new ServiceError('NOT_FOUND', 404);
      if (!['/ws','/session'].includes(match[2]??'')) {
        const access = await verifyAccess(env.SERVICE_SECRET, bearer(request));
        if (access.kind !== 'owner') throw new ServiceError('FORBIDDEN', 403);
        await directory(env,access,'/check');
      }
      return await env.TABLES.get(env.TABLES.idFromName(match[1]!)).fetch(request);
    } catch (error) { return errorResponse(error); }
  },
};

export class MahjongTable extends DurableObject<Env> {
  private async serialized<T>(run: () => Promise<T>): Promise<T> {
    // Expected authorization/validation failures must not escape the concurrency
    // gate: Cloudflare resets an object if blockConcurrencyWhile rejects.
    const result = await this.ctx.blockConcurrencyWhile(async () => {
      try { return { ok: true as const, value: await run() }; }
      catch (error) { return { ok: false as const, error }; }
    });
    if (!result.ok) throw result.error;
    return result.value;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const gameId = url.pathname.split('/')[3]!;
      if(url.pathname.startsWith('/v1/shares/')) {
        if(request.method!=='GET')throw new ServiceError('METHOD_NOT_ALLOWED',405);
        const share=await this.ctx.storage.get<{access:Access;exp:number}>(`share:${url.pathname.split('/')[4]}`);
        if(!share||share.exp<=Date.now())throw new ServiceError('SHARE_UNAVAILABLE',404);
        await directory(this.env,share.access,'/check');
        return json({ok:true,...await this.archive(gameId)});
      }
      if (url.pathname.endsWith('/session')) {
        if (!['GET', 'POST'].includes(request.method)) throw new ServiceError('METHOD_NOT_ALLOWED', 405);
        const origin = request.headers.get('Origin');
        if ((request.method === 'POST' || origin) && origin !== url.origin) throw new ServiceError('FORBIDDEN', 403);
        const input = request.method === 'POST' ? await readJson(request) : null;
        if (input && Object.keys(input).some(key => key !== 'credential')) throw new ServiceError('INVALID_SESSION');
        const access = input ? await verifyAccess(this.env.SERVICE_SECRET, input.credential) : await readSession(request, gameId, this.env.SERVICE_SECRET);
        checkSessionAccess(url, access);
        return await this.serialized(async () => {
          const saved = await this.ctx.storage.get<Checkpoint>('checkpoint');
          if (!saved) throw new ServiceError('NOT_FOUND', 404);
          new TableCore(saved).authorize(access);
          await directory(this.env,access,'/check');
          let credential=input?.credential;
          let sessionAccess=access;
          if(input && access.purpose==='invite') {
            sessionAccess=await this.consumeInvite(access);
            credential=await issueAccess(this.env.SERVICE_SECRET,sessionAccess);
          }
          const response = json({ ok: true, kind: access.kind, seat: access.seat, expiresAt: access.exp });
          if (input) response.headers.set('Set-Cookie', sessionCookie(url, gameId, credential, sessionAccess));
          return response;
        });
      }
      if (url.pathname.endsWith('/ws')) {
        if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new ServiceError('WEBSOCKET_REQUIRED', 426);
        let resumeAccess: Access | undefined;
        if (url.searchParams.has('seat') || url.searchParams.has('view')) {
          if (request.headers.get('Origin') !== url.origin) throw new ServiceError('FORBIDDEN', 403);
          resumeAccess = await readSession(request, gameId, this.env.SERVICE_SECRET);
        }
        return await this.serialized(async () => {
          if (!await this.ctx.storage.get('checkpoint')) throw new ServiceError('NOT_FOUND', 404);
          if (this.ctx.getWebSockets().length >= 32) throw new ServiceError('TABLE_CONNECTION_LIMIT', 429);
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server!);
          server!.serializeAttachment({ expiresAt: Date.now() + 15000, resumeAccess } satisfies Connection);
          await this.scheduleConnections();
          return new Response(null, { status: 101, webSocket: client });
        });
      }
      const access = await verifyAccess(this.env.SERVICE_SECRET, bearer(request));
      if (access.kind !== 'owner') throw new ServiceError('FORBIDDEN', 403);
      await directory(this.env,access,'/check');
      const suffix=url.pathname.slice(`/v1/tables/${gameId}`.length);
      if(suffix)return await this.historyRequest(request,access,gameId,suffix);
      const input = request.method === 'PUT' ? await readJson(request) : undefined;
      return await this.serialized(async () => {
        const saved = await this.ctx.storage.get<Checkpoint>('checkpoint');
        let core: TableCore;
        if (request.method === 'PUT') {
          const metadata = normalizeTable(input, access, gameId, Date.now());
          if (saved) {
            core = new TableCore(saved);
            core.authorize(access);
            const same = core.metadata.ruleset === metadata.ruleset && JSON.stringify(core.metadata.ruleOptions ?? {}) === JSON.stringify(metadata.ruleOptions ?? {}) && core.metadata.tableName === metadata.tableName && core.metadata.timeoutMs === metadata.timeoutMs && JSON.stringify(core.metadata.seats) === JSON.stringify(metadata.seats);
            if (!same) throw new ServiceError('TABLE_ALREADY_EXISTS', 409);
          } else {
            core = new TableCore(metadata);
            await directory(this.env,access,'/reserve',{access,row:this.libraryRow(core)});
            await this.persist(core);
          }
        } else if (request.method === 'GET') {
          if (!saved) throw new ServiceError('NOT_FOUND', 404);
          core = new TableCore(saved);
          core.authorize(access);
        } else throw new ServiceError('METHOD_NOT_ALLOWED', 405);
        return json(await this.describe(core,access), request.method === 'PUT' && !saved ? 201 : 200);
      });
    } catch (error) { return errorResponse(error); }
  }

  private async describe(core: TableCore, access:Access) {
    const metadata = core.metadata;
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    const base = { v: 1 as const, tenant: metadata.tenant, owner: metadata.owner, epoch:access.epoch??0, gameId: metadata.gameId, exp };
    const seats = await Promise.all(metadata.seats.map(async seat => {
      const credential = await issueAccess(this.env.SERVICE_SECRET, { ...base, kind: seat.kind, seat: seat.seat,seatEpoch:metadata.seatEpochs?.[seat.seat]??0,
        ...(seat.kind==='human'?{purpose:'invite' as const,jti:crypto.randomUUID()}:{}) });
      return { ...seat, ...(seat.kind === 'ai' ? { seatCredential: credential } : { humanInviteTicket: credential }), credentialExpiresAtMs: exp };
    }));
    return { ok: true, gameId: metadata.gameId, tableName:metadata.tableName, roomType: 'friend', ruleset: metadata.ruleset, ruleVersion: metadata.ruleVersion, ruleOptions: metadata.ruleOptions,mode:metadata.mode??'live',source:metadata.source,coach:metadata.coach,...(core.challenge?{challenge:challengeSummary(core)}:{}), aiDecisionTimeoutMs: metadata.timeoutMs,
      ownerMode: core.ownerSeat === null ? 'spectator' : 'player', seats,
      ownerSeat: core.ownerSeat,
      // The viewer token is scoped to this table and never authorizes actions.
      spectatorEmbedTicket: await issueAccess(this.env.SERVICE_SECRET, { ...base, kind: 'viewer' }),
      spectatorEmbedTicketExpiresAtMs: exp };
  }

  private libraryRow(core:TableCore) {
    const m=core.metadata;
    return {gameId:m.gameId,owner:m.owner,tableName:m.tableName,ruleset:m.ruleset,phase:m.coach&&m.coach.status!=='active'?'done':core.state?.phase??'waiting',mode:m.mode??'live',createdAt:m.createdAtMs};
  }
  private async consumeInvite(access:Access):Promise<Access> {
    if(access.purpose!=='invite'||!access.jti)throw new ServiceError('INVALID_INVITATION');
    if(await this.ctx.storage.get(`used-invite:${access.jti}`))throw new ServiceError('INVITATION_ALREADY_USED',409);
    await this.ctx.storage.put(`used-invite:${access.jti}`,true);
    return {...access,purpose:'session',jti:crypto.randomUUID()};
  }
  private async frameAt(index:number):Promise<HistoryFrame> {
    const imported=await this.ctx.storage.get<HistoryFrame>(`import:${String(index).padStart(4,'0')}`);
    if(imported)return imported;
    const saved=await this.ctx.storage.get<{checkpoint:Checkpoint;at:number}>(`frame:${String(index).padStart(4,'0')}`);
    if(!saved)throw new ServiceError('HISTORY_STEP_NOT_FOUND',404);
    return projectFrame(saved.checkpoint,index,saved.at);
  }
  private async archive(gameId:string) {
    const saved=await this.ctx.storage.get<Checkpoint>('checkpoint');
    if(saved && new TableCore(saved).state?.phase!=='done' && (!saved.metadata.coach || saved.metadata.coach.status==='active'))throw new ServiceError('GAME_NOT_FINISHED',409);
    const count=await this.ctx.storage.get<number>('frame-count')??0;
    const frames:HistoryFrame[]=[];
    for(let index=0;index<count;index++)frames.push(await this.frameAt(index));
    return {schema:'dsh-mahjong.replay.v1',gameId,frames};
  }
  // RPC only: the HTTP router never accepts caller-provided engine checkpoints.
  async initializePractice(checkpoint:Checkpoint,access:Access) {
    return this.serialized(async()=>{
      const core=new TableCore(checkpoint);core.authorize(access);
      if(await this.ctx.storage.get('checkpoint')||await this.ctx.storage.get('import-owner'))throw new ServiceError('TABLE_ALREADY_EXISTS',409);
      await directory(this.env,access,'/reserve',{access,row:this.libraryRow(core)});
      await this.persist(core);
      return this.describe(core,access);
    });
  }
  private async historyRequest(request:Request,access:Access,gameId:string,suffix:string):Promise<Response> {
    const body=['POST','PUT'].includes(request.method)?await readJson(request,suffix==='/replay'?24*1024*1024:suffix==='/challenge'?2*1024*1024:16384):undefined;
    return this.serialized(async()=>{
      const saved=await this.ctx.storage.get<Checkpoint>('checkpoint');
      const core=saved?new TableCore(saved):null;
      const imported=await this.ctx.storage.get<{tenant:string;owner:string}>('import-owner');
      if(core)core.authorize(access);
      else if(imported && (imported.owner!==access.owner||imported.tenant!==access.tenant))throw new ServiceError('FORBIDDEN',403);
      if(suffix==='/challenge' && request.method==='PUT'){
        if(core||imported)throw new ServiceError('TABLE_ALREADY_EXISTS',409);
        const challenge=new TableCore(createChallengeCheckpoint(body,access,gameId,Date.now()));
        await directory(this.env,access,'/reserve',{access,row:this.libraryRow(challenge)});
        await this.persist(challenge);return json(await this.describe(challenge,access),201);
      }
      if(suffix==='/challenge' && request.method==='GET' && core?.challenge)return json({ok:true,gameId,challenge:challengeSummary(core)});
      if(suffix==='/coach' && request.method==='PUT'){
        if(core||imported)throw new ServiceError('TABLE_ALREADY_EXISTS',409);
        const checkpoint=createCoachCheckpoint(body.lessonId,access,gameId,Date.now());
        const lessonCore=new TableCore(checkpoint);
        await directory(this.env,access,'/reserve',{access,row:this.libraryRow(lessonCore)});
        await this.persist(lessonCore);return json(await this.describe(lessonCore,access),201);
      }
      if(suffix==='/coach' && request.method==='GET' && core?.metadata.coach){
        return json({ok:true,gameId,coach:core.metadata.coach,lesson:coachLesson(core.metadata.coach.lessonId)});
      }
      if(suffix==='/replay' && request.method==='PUT') {
        if(core||imported)throw new ServiceError('TABLE_ALREADY_EXISTS',409);
        const archive=validateArchive(body);
        const frames=archive.frames.map(frame=>({...frame,gameId}));
        const first=frames[0]!;
        await directory(this.env,access,'/reserve',{access,row:{gameId,owner:access.owner,tableName:first.tableName,ruleset:first.ruleset,phase:'imported',mode:'replay',createdAt:Date.now(),imported:true}});
        await this.ctx.storage.transaction(async t=>{
          await t.put('import-owner',{tenant:access.tenant,owner:access.owner});await t.put('frame-count',frames.length);
          for(const frame of frames)await t.put(`import:${String(frame.eventIndex).padStart(4,'0')}`,frame);
        });
        return json({ok:true,gameId,frameCount:frames.length},201);
      }
      if(!core&&!imported)throw new ServiceError('NOT_FOUND',404);
      if(suffix==='/history' && request.method==='GET') {
        const count=await this.ctx.storage.get<number>('frame-count')??0;
        const items=[];
        for(let i=0;i<count;i++){const f=await this.frameAt(i);items.push({eventIndex:i,at:f.at,label:f.label,phase:f.phase});}
        return json({ok:true,gameId,items,imported:Boolean(imported),canPractice:core?.state?.phase==='done'});
      }
      if(/^\/history\/\d+$/.test(suffix)&&request.method==='GET') {
        const index=Number(suffix.split('/')[2]);
        const frame=await this.frameAt(index);
        return json({ok:true,gameId,frame,canPractice:core?.state?.phase==='done'&&['swap3','dingque','playing'].includes(frame.phase)});
      }
      if(suffix==='/replay' && request.method==='GET')return json({ok:true,...await this.archive(gameId)});
      if(suffix==='/practice' && request.method==='POST') {
        if(!core||core.state?.phase!=='done')throw new ServiceError('PRACTICE_STATE_UNAVAILABLE',422);
        if(!Number.isInteger(body.eventIndex)||body.eventIndex<0||!validGameId(body.gameId)||body.gameId===gameId)throw new ServiceError('INVALID_PRACTICE');
        const historical=await this.ctx.storage.get<{checkpoint:Checkpoint;at:number}>(`frame:${String(body.eventIndex).padStart(4,'0')}`);
        if(!historical)throw new ServiceError('PRACTICE_STATE_UNAVAILABLE',422);
        const metadata=normalizeTable(body.table,access,body.gameId,Date.now());
        const checkpoint=practiceCheckpoint(historical.checkpoint,metadata,body.eventIndex,Date.now());
        const description=await (this.env.TABLES.get(this.env.TABLES.idFromName(body.gameId)) as any).initializePractice(checkpoint,access);
        return json(description,201);
      }
      if(suffix==='/shares' && request.method==='GET') {
        const shares=await this.ctx.storage.list<{exp:number}>({prefix:'share:'});
        return json({ok:true,gameId,items:[...shares].filter(([,s])=>s.exp>Date.now()).map(([key,s])=>({shareId:key.slice(6),expiresAt:s.exp,sharePath:`/hand/?mode=archive&gameId=${gameId}&share=${key.slice(6)}`}))});
      }
      if(suffix==='/shares' && request.method==='POST') {
        await this.archive(gameId);
        const shares=await this.ctx.storage.list<{exp:number}>({prefix:'share:'});
        for(const [key,value] of shares)if(value.exp<=Date.now()){await this.ctx.storage.delete(key);shares.delete(key);}
        if(shares.size>=20)throw new ServiceError('SHARE_LIMIT',429);
        const shareId=crypto.randomUUID(),expiresAt=Date.now()+7*86400000;
        await this.ctx.storage.put(`share:${shareId}`,{access,exp:expiresAt});
        return json({ok:true,gameId,shareId,expiresAt,sharePath:`/hand/?mode=archive&gameId=${gameId}&share=${shareId}`},201);
      }
      if(/^\/shares\/[a-f0-9-]{36}$/.test(suffix)&&request.method==='DELETE') {
        await this.ctx.storage.delete(`share:${suffix.split('/')[2]}`);return json({ok:true,gameId});
      }
      if(/^\/seats\/[0-3]\/revoke$/.test(suffix)&&request.method==='POST'&&core) {
        const seat=Number(suffix.split('/')[2]);
        core.metadata.seatEpochs={...core.metadata.seatEpochs,[seat]:(core.metadata.seatEpochs?.[seat]??0)+1};
        await this.persist(core);await this.broadcast(core);
        return json({ok:true,gameId,seat});
      }
      throw new ServiceError('METHOD_NOT_ALLOWED',405);
    });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let message: any;
    try {
      if (typeof raw !== 'string' || raw.length > 16384) throw new ServiceError('INVALID_MESSAGE');
      message = JSON.parse(raw);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new ServiceError('INVALID_MESSAGE');
      const connection: Connection = socket.deserializeAttachment();
      if (!connection || connection.expiresAt <= Date.now()) throw new ServiceError('UNAUTHORIZED', 401);
      const rate=connection.rate && Date.now()-connection.rate.at<10000 ? connection.rate : {at:Date.now(),count:0};
      if(++rate.count>120)throw new ServiceError('RATE_LIMIT',429);
      socket.serializeAttachment({...connection,rate});
      if (message.type === 'HEARTBEAT' && typeof message.nonce === 'string' && message.nonce.length <= 120) {
        socket.send(JSON.stringify({ type: 'HEARTBEAT_ACK', nonce: message.nonce })); return;
      }
      let authenticated: Access | undefined;
      if (message.type === 'DSH_SEAT_JOIN' || message.type === 'DSH_SPECTATE') {
        const credential = message.type === 'DSH_SEAT_JOIN' ? message.seatCredential || message.humanInviteTicket : message.apiToken || message.spectatorEmbedTicket;
        authenticated = credential ? await verifyAccess(this.env.SERVICE_SECRET, credential) : connection.resumeAccess;
        if (!authenticated) throw new ServiceError('UNAUTHORIZED', 401);
      }
      await this.serialized(async () => {
        const saved = await this.ctx.storage.get<Checkpoint>('checkpoint');
        if (!saved) throw new ServiceError('NOT_FOUND', 404);
        const core = new TableCore(saved);
        const current: Connection = socket.deserializeAttachment();
        if (!current || current.expiresAt <= Date.now()) throw new ServiceError('UNAUTHORIZED', 401);
        if (message.gameId !== core.metadata.gameId) throw new ServiceError('FORBIDDEN', 403);
        if (authenticated) {
          if (current.access) throw new ServiceError('ALREADY_AUTHENTICATED', 409);
          core.authorize(authenticated);
          await directory(this.env,authenticated,'/check');
          if(authenticated.purpose==='invite')authenticated=await this.consumeInvite(authenticated);
          if (message.type === 'DSH_SEAT_JOIN') {
            if (!['ai', 'human'].includes(authenticated.kind) || authenticated.seat !== message.seat) throw new ServiceError('FORBIDDEN', 403);
            core.join(authenticated.seat!, Date.now());
            await this.persist(core);
            // Reconnection replaces the old seat connection; it does not create a
            // second independently acting player for the same seat.
            for (const other of this.ctx.getWebSockets()) {
              const previous: Connection = other.deserializeAttachment();
              if (other !== socket && previous?.access?.seat === authenticated.seat && ['ai', 'human'].includes(previous.access!.kind)) {
                other.serializeAttachment({ expiresAt: 0 });
                other.close(4001, 'seat reconnected');
              }
            }
            socket.serializeAttachment({ access: authenticated, expiresAt: authenticated.exp, bound: authenticated.kind === 'human' } satisfies Connection);
            socket.send(JSON.stringify({ type: 'JOINED', gameId: core.metadata.gameId, playerId: `seat-${authenticated.seat}`, authoritative: true, isFirst: false }));
            socket.send(JSON.stringify({ type: 'DSH_SEAT_JOINED', gameId: core.metadata.gameId, seat: authenticated.seat, kind: authenticated.kind, ok: true, resumeCredential: await issueAccess(this.env.SERVICE_SECRET,authenticated) }));
          } else {
            if (!['owner', 'viewer'].includes(authenticated.kind)) throw new ServiceError('FORBIDDEN', 403);
            socket.serializeAttachment({ access: authenticated, expiresAt: authenticated.exp } satisfies Connection);
            socket.send(JSON.stringify({ type: 'JOINED', gameId: core.metadata.gameId, playerId: `seat-${core.ownerSeat ?? 0}`, authoritative: true, isFirst: false }));
            socket.send(JSON.stringify({ type: 'DSH_SPECTATING', gameId: core.metadata.gameId, ok: true, scope: core.ownerSeat === null ? 'full' : 'self', ownerSeat: core.ownerSeat }));
          }
          await this.scheduleConnections(core.nextAlarm());
          await this.broadcast(core, { initial: socket, previous: new TableCore(saved) });
          return;
        }
        const access = current.access;
        if (!access) throw new ServiceError('UNAUTHORIZED', 401);
        core.authorize(access);
        await directory(this.env,access,'/check');
        if (message.type === 'AI_SEAT_BIND') {
          if (access.kind !== 'ai' || message.seat !== access.seat || message.modelId !== core.metadata.seats[access.seat!]?.modelId) throw new ServiceError('FORBIDDEN', 403);
          socket.serializeAttachment({ ...current, bound: true });
          socket.send(JSON.stringify({ type: 'AI_SEAT_BIND_ACK', gameId: message.gameId, seat: access.seat, ok: true }));
        } else if (message.type === 'ACTION') {
          if (!['ai', 'human'].includes(access.kind) || !current.bound) throw new ServiceError('FORBIDDEN', 403);
          const ack = access.kind === 'human' ? core.submitHuman(access.seat!, message, Date.now()) : core.submit(access.seat!, message, Date.now());
          await this.persist(core);
          socket.send(JSON.stringify(ack));
        } else if (message.type !== 'AI_DECISION_GET' || !current.bound) throw new ServiceError('UNSUPPORTED_MESSAGE');
        await this.broadcast(core, { force: message.type === 'AI_DECISION_GET' ? socket : undefined, previous: new TableCore(saved) });
      });
    } catch (error) {
      const errorCode = error instanceof ServiceError ? error.code : 'INVALID_MESSAGE';
      const ack = message?.type === 'ACTION' && typeof message.actionId === 'string' && message.actionId.length <= 120;
      try { socket.send(JSON.stringify({ type: ack ? 'ACTION_ACK' : 'ERROR', ...(ack ? { actionId: message.actionId, gameId: message.gameId } : {}), ok: false, errorCode, error: errorCode })); } catch { /* Peer disconnected. */ }
      if (['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_MESSAGE'].includes(errorCode)) socket.close(1008, errorCode);
    }
  }

  private async broadcast(core: TableCore, options: { force?: WebSocket; initial?: WebSocket; previous?: TableCore } = {}): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const connection: Connection = socket.deserializeAttachment();
      if (!connection?.access) continue;
      if (connection.expiresAt <= Date.now()) { socket.close(1008, 'credential expired'); continue; }
      const access = connection.access;
      try {
        core.authorize(access);
        await directory(this.env,access,'/check');
        if (access.kind === 'ai' || access.kind === 'human') {
          if (connection.bound) {
            const decision = core.decision(access.seat!);
            if (connection.decisionId && connection.decisionId !== decision?.decisionId) socket.send(JSON.stringify({ type: 'AI_DECISION_CLOSED', gameId: core.metadata.gameId, seat: access.seat, decisionId: connection.decisionId, source: core.resolutions[connection.decisionId] ?? null, reason: 'resolved', ok: true }));
            if (decision && (socket === options.force || connection.decisionId !== decision.decisionId)) socket.send(JSON.stringify({ type: 'AI_DECISION', gameId: core.metadata.gameId, seat: access.seat, decision }));
            socket.serializeAttachment({ ...connection, decisionId: decision?.decisionId });
          }
          if (access.kind === 'human') this.sendView(socket, core, access.seat!, false, options);
        } else this.sendView(socket, core, core.ownerSeat, core.ownerSeat === null, options);
      } catch { socket.close(1011, 'view unavailable'); }
    }
  }

  private sendView(socket: WebSocket, core: TableCore, seat: number | null, full: boolean,
    options: { initial?: WebSocket; previous?: TableCore }): void {
    const view = core.view(seat, full);
    if (socket === options.initial || !options.previous) { socket.send(JSON.stringify(view)); return; }
    const previous = options.previous.view(seat, full);
    const key = (entry: any[]) => JSON.stringify([entry[0], entry[1]]);
    const before = new Map(previous.entries.map(entry => [key(entry), entry]));
    const after = new Map(view.entries.map(entry => [key(entry), entry]));
    const entries = view.entries.filter(entry => JSON.stringify(before.get(key(entry))?.[2]) !== JSON.stringify(entry[2]));
    for (const [id, entry] of before) if (!after.has(id)) entries.push([entry[0], entry[1], null]);
    if (entries.length) socket.send(JSON.stringify({ type: 'UPDATE', full: false, entries }));
  }

  private connectionDeadline(): number | null {
    const deadlines = this.ctx.getWebSockets().map(socket => (socket.deserializeAttachment() as Connection)?.expiresAt).filter(t => t > Date.now());
    return deadlines.length ? Math.min(...deadlines) : null;
  }
  private async scheduleConnections(gameAlarm?: number | null) {
    const existing = gameAlarm === undefined ? await this.ctx.storage.getAlarm() : gameAlarm;
    const deadlines = [existing, this.connectionDeadline()].filter((n): n is number => typeof n === 'number');
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 10, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
  private async persist(core: TableCore) {
    const deadlines = [core.nextAlarm(), this.connectionDeadline()].filter((n): n is number => typeof n === 'number');
    const nextAlarm = deadlines.length ? Math.max(Date.now() + 10, Math.min(...deadlines)) : null;
    const checkpoint=core.checkpoint();
    const before=await this.ctx.storage.get<Checkpoint>('checkpoint');
    // Repeated receipts, credential changes and auto-flower preferences are
    // persisted, but do not consume the finite sequence of playable positions.
    const historyKey=(c:Checkpoint|undefined)=>c && JSON.stringify([c.engine,c.metadata.joined,c.metadata.coach,c.entries.map(([kind,key,value])=>[kind,key,kind==='gb'&&value?{...value,autoBuhuaBySeat:undefined}:value])]);
    const changed=historyKey(before)!==historyKey(checkpoint);
    const count=await this.ctx.storage.get<number>('frame-count')??0;
    if(changed && count>=MAX_HISTORY_FRAMES)throw new ServiceError('HISTORY_QUOTA_REACHED',429);
    await this.ctx.storage.transaction(async transaction => {
      await transaction.put('checkpoint', checkpoint);
      if(changed){
        await transaction.put(`frame:${String(count).padStart(4,'0')}`,{checkpoint,at:Date.now()});
        await transaction.put('frame-count',count+1);
      }
      if(!before||this.libraryRow(new TableCore(before)).phase!==this.libraryRow(core).phase)await transaction.put('directory-update',{row:this.libraryRow(core)});
      if(core.metadata.coach && core.metadata.coach.status!=='active')await transaction.put('coach-result',{gameId:core.metadata.gameId,owner:core.metadata.owner,...core.metadata.coach});
      for (const event of core.events) await transaction.put(`replay:${String(event.seq).padStart(16, '0')}`, event);
      if (nextAlarm === null) await transaction.deleteAlarm();
      else await transaction.setAlarm(nextAlarm);
    });
    const access:Access={v:1,kind:'owner',tenant:core.metadata.tenant,owner:core.metadata.owner,exp:Date.now()+1000};
    try {
      const update=await this.ctx.storage.get('directory-update');
      if(update){await directory(this.env,access,'/update',update);await this.ctx.storage.delete('directory-update');}
      const lesson=await this.ctx.storage.get('coach-result');
      if(lesson){await directory(this.env,access,'/coach-result',lesson);await this.ctx.storage.delete('coach-result');}
    }catch{await this.ctx.storage.setAlarm(Date.now()+5000);}
  }
  async alarm(): Promise<void> {
    await this.serialized(async () => {
      for (const socket of this.ctx.getWebSockets()) {
        const connection: Connection = socket.deserializeAttachment();
        if (!connection || connection.expiresAt <= Date.now()) socket.close(1008, 'credential expired');
      }
      const saved = await this.ctx.storage.get<Checkpoint>('checkpoint');
      if (!saved) return;
      const core = new TableCore(saved);
      core.alarm(Date.now());
      await this.persist(core);
      await this.broadcast(core, { previous: new TableCore(saved) });
    });
  }
  webSocketClose(socket: WebSocket, code: number, reason: string): void { socket.close(code, reason); }
  webSocketError(socket: WebSocket): void { socket.close(1011, 'connection error'); }
}
