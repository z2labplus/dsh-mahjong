import type {Client} from './client';
export class HistoryRuntime {
  private index=0;
  private count=0;
  private localFrames:any[]|null=null;
  private first=0;
  constructor(private client:Client,private gameId:string,private parentOrigin:string,private changed:()=>void){}
  currentEventIndex(){return this.index;}
  canPrev(){return this.index>this.first;}
  canNext(){return this.index+1<this.count;}
  prev(){if(!this.canPrev())return false;this.navigate(this.index-1);return true;}
  next(){if(!this.canNext())return false;this.navigate(this.index+1);return true;}
  private navigate(index:number){
    if(this.localFrames)this.apply(this.localFrames[index],this.localFrames.length,this.first);
    else window.parent.postMessage({type:'dsh-mahjong:history-step',gameId:this.gameId,eventIndex:index},this.parentOrigin);
  }
  apply(frame:any,count:number,first=0){
    if(frame?.schema!=='dsh-mahjong.frame.v1'||frame.gameId!==this.gameId||!Number.isInteger(frame.eventIndex)||!Array.isArray(frame.view?.entries)||!Number.isInteger(frame.perspective?.seat))throw new Error('牌谱步骤无效');
    this.index=frame.eventIndex;this.count=count;this.first=first;
    this.client.setLocalGame({gameId:this.gameId,playerId:`seat-${frame.perspective.seat}`,authoritative:true});
    const entries=structuredClone(frame.view.entries);
    for(const [kind,,value] of entries)if(kind==='match'&&value)value.friendConfig={waitMode:'noTimeout',timeoutMs:null};
    this.client.applyLocalSnapshot(entries);
    this.changed();
  }
  async start(sharedId?:string){
    if(sharedId){
      if(!/^[a-f0-9-]{36}$/.test(sharedId))throw new Error('分享链接无效');
      const response=await fetch(`/v1/shares/${this.gameId}/${sharedId}`,{cache:'no-store'});
      if(!response.ok)throw new Error('分享已过期或已被撤销');
      const archive=await response.json();
      if(archive.schema!=='dsh-mahjong.replay.v1'||!archive.frames?.length)throw new Error('牌谱文件无效');
      this.localFrames=archive.frames;this.first=Math.max(0,archive.frames.findIndex((f:any)=>f.phase!=='waiting'));
      this.apply(archive.frames[this.first],archive.frames.length,this.first);return;
    }
    await new Promise<void>((resolve,reject)=>{
      const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('请从 Harness 牌谱入口打开'));},15000);
      const receive=(event:MessageEvent)=>{
        if(event.source!==window.parent||event.origin!==this.parentOrigin||event.data?.type!=='dsh-mahjong:history-frame')return;
        try{this.apply(event.data.frame,event.data.count,event.data.first);clearTimeout(timer);resolve();}
        catch(error){clearTimeout(timer);reject(error);}
      };
      window.addEventListener('message',receive);
      window.parent.postMessage({type:'dsh-mahjong:history-request',gameId:this.gameId},this.parentOrigin);
      window.addEventListener('pagehide',()=>window.removeEventListener('message',receive),{once:true});
    });
  }
}
