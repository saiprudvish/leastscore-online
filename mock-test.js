const Module = require('module');
const original = Module._load;
function express(){ const app={use(){},post(){},get(){}}; return app; }
express.static=()=>()=>{}; express.json=()=>()=>{};
Module._load=function(req,parent,isMain){
  if(req==='express') return express;
  if(req==='http') return {createServer:()=>({listen(){}})};
  if(req==='socket.io') return {Server: class { constructor(){ } use(){} on(){} to(){return {emit(){}}} }};
  if(req==='bcryptjs') return {hash:async x=>x,compare:async()=>true};
  if(req==='jsonwebtoken') return {sign:()=>'',verify:()=>({username:'test'})};
  return original.call(this,req,parent,isMain);
};
const g=require('./server_testable');
const room=g.makeRoom('alice',{targetScore:100,turnSeconds:10,dealSeconds:10});
room.code='TEST1';
for (const [username,bot] of [['alice',false],['bob',false],['Bot 1',true],['Bot 2',true]]) room.players.push({username,bot,score:0,eliminated:false,connected:true,socketId:null,hand:[],left:[],picked:[],declared:false,lastAction:null});
g.newRound(room);
if(room.round!==1 || room.players.some(p=>p.hand.length!==5)) throw Error('initial deal failed');
const order=[];
for(let i=0;i<4;i++){
  const p=room.players[room.turn]; order.push(p.username);
  const c=p.hand[0];
  if(!g.performMove(room,p,'deck',[c])) throw Error('move failed for '+p.username);
}
if(!room.roundReady) throw Error('round 1 did not unlock declaration after all players moved');
if(room.open.length<2) throw Error('discard/open pile was not updated');
const current=room.players[room.turn];
if(!g.declarePlayer(room,current,false)) throw Error('declare failed after round 1');
setTimeout(()=>{
  if(!room.declaration) throw Error('declaration missing');
  console.log('MOCK TEST PASSED');
  console.log({round:room.round,status:room.status,turn:current.username,roundReady:room.roundReady,openCount:room.open.length});
  process.exit(0);
},1300);
