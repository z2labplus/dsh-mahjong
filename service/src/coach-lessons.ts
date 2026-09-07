export const COACH_LESSONS = [
 {id:'swap3',title:'换三张：保留成组牌',goal:'把最分散的三张同门牌换出去，保留已经相连或成对的牌。',hint:'万子已经连成一到九，条子成对；观察筒子的连接情况。',success:'你换出了二筒、五筒、八筒，保留了成组潜力更好的两门牌。',retry:'操作符合规则，但没有达成本关目标。比较万子的连张、条子的对子和筒子的散张，再练一次。'},
 {id:'dingque',title:'定缺：比较三门结构',goal:'在这个起手局面选择最容易清空的一门。',hint:'万子和条子各有六张，筒子只有一筒和九筒。',success:'定缺筒子只需清掉两张，同时保留两门已经连成顺子的牌。',retry:'本关筒子最少且两张互不连接。先考虑清缺难度，再比较牌型结构。'},
 {id:'discard',title:'弃牌：先打缺门',goal:'定缺筒子后，先打掉手中剩余的筒子。',hint:'这是定缺约束：手中还有九筒时，必须先打九筒。',success:'你先打掉了九筒，完成清缺，后续才能自由选择其余两门弃牌。',retry:'先检查定缺门。只要还留有缺门牌，就必须先打缺门。'},
 {id:'yaojiu',title:'幺九：识别整副牌型',goal:'判断当前手牌是否已经可以按带幺九自摸。',hint:'可拆为两组一二三、两组七八九和一万对子；每一组都含一或九。',success:'正确自摸。四组顺子和一对将都含一或九，满足血战带幺九的结构。',retry:'这手牌已经成胡，并且每一组都含一或九。重新拆分手牌，再决定是否自摸。'},
] as const;
export type CoachState={lessonId:typeof COACH_LESSONS[number]['id'];status:'active'|'passed'|'retry';feedback?:string;score?:number};
export function coachLesson(id:string){return COACH_LESSONS.find(lesson=>lesson.id===id);}
export function coachPassed(id:string,raw:any,tileKey:(id:number)=>number|null):boolean {
 if(id==='swap3')return raw.kind==='swap3'&&JSON.stringify(raw.tileIds.map(tileKey).sort((a:number,b:number)=>a-b))===JSON.stringify([10,13,16]);
 if(id==='dingque')return raw.kind==='dingque'&&raw.suit==='p';
 if(id==='discard')return raw.kind==='discard'&&tileKey(raw.tileId)===17;
 return id==='yaojiu'&&raw.kind==='hu'&&raw.source==='self';
}
