const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const DATA_FILE = path.join(__dirname, "users.json");

let users = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) : {};
const rooms = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}
function tokenFor(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
}
function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Please login again." }); }
}
app.post("/api/register", async (req,res)=>{
  const username = String(req.body.username||"").trim().toLowerCase();
  const password = String(req.body.password||"");
  if (!/^[a-z0-9_]{3,18}$/.test(username)) return res.status(400).json({error:"Username: 3–18 letters, numbers or _."});
  if (password.length < 4) return res.status(400).json({error:"Password must be at least 4 characters."});
  if (users[username]) return res.status(409).json({error:"Username already exists."});
  users[username] = { password: await bcrypt.hash(password, 10), createdAt: Date.now() };
  saveUsers();
  res.json({token:tokenFor(username), username});
});
app.post("/api/login", async (req,res)=>{
  const username = String(req.body.username||"").trim().toLowerCase();
  const password = String(req.body.password||"");
  if (!users[username] || !(await bcrypt.compare(password, users[username].password))) return res.status(401).json({error:"Invalid username or password."});
  res.json({token:tokenFor(username), username});
});
app.get("/api/me", auth, (req,res)=>res.json({username:req.user.username}));

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["♠","♥","♦","♣"];
const rankValue = r => r==="A" ? 1 : r==="J" ? 11 : r==="Q" ? 12 : r==="K" ? 13 : Number(r);
function makeDeck() {
  const deck=[]; for(const s of SUITS) for(const r of RANKS) deck.push({id:r+s, rank:r, suit:s});
  return deck;
}
function shuffle(a) {
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function cardScore(c){ return rankValue(c.rank); }
function color(s){ return (s==="♥"||s==="♦") ? "red" : "black"; }
function publicCard(c){ return c ? {id:c.id,rank:c.rank,suit:c.suit,color:color(c.suit)} : null; }
function handScore(hand){ return hand.reduce((n,c)=>n+cardScore(c),0); }

function validSequence(cards) {
  if(cards.length < 3 || cards.length % 2 === 0) return false;
  const suit=cards[0].suit;
  if(!cards.every(c=>c.suit===suit)) return false;
  const vals=cards.map(c=>rankValue(c.rank)).sort((a,b)=>a-b);
  if(new Set(vals).size!==vals.length) return false;
  // A can only be low in A2345, or high in 10JQKA. No KA234.
  if(vals.includes(1)) {
    const low=[1,2,3,4,5].every(v=>vals.includes(v));
    const high=[1,10,11,12,13].every(v=>vals.includes(v));
    if(cards.length===5) return low || high;
    return false;
  }
  return vals.every((v,i)=>i===0 || v===vals[i-1]+1);
}
function canPartition(hand) {
  if(hand.length!==5) return false;
  // Every valid 5-card declaration can be one sequence, or pair+triple, or 2+2 plus? impossible with 5.
  if(validSequence(hand)) return true;
  const byRank={}; hand.forEach(c=>(byRank[c.rank]??=[]).push(c));
  const groups=Object.values(byRank).map(g=>g.length);
  // A legal even-of-a-kind group can be 2 or 4; remaining 3 can be a sequence.
  for(const rank of Object.keys(byRank)){
    const g=byRank[rank];
    if(g.length===2 || g.length===4){
      const rest=hand.filter(c=>c.rank!==rank);
      if(rest.length===3 && validSequence(rest)) return true;
    }
  }
  // Four-of-a-kind + one card is not a complete declaration under these rules.
  return false;
}

function isBot(p){ return !!p.bot; }
function activePlayers(room){ return room.players.filter(p=>!p.eliminated); }
function nextTurn(room){
  if(!room.players.length) return;
  let n=room.turn;
  for(let i=0;i<room.players.length;i++){
    n=(n+1)%room.players.length;
    if(!room.players[n].eliminated){ room.turn=n; return; }
  }
}
function allDiscardOptions(hand){
  return hand.map((c,i)=>({c,i}));
}
function bestBotDiscard(hand){
  // Prefer discarding a high-value card that is least useful to a visible pair/sequence.
  let best=0, bestScore=-Infinity;
  for(let i=0;i<hand.length;i++){
    const c=hand[i];
    let utility=0;
    const sameRank=hand.filter(x=>x.rank===c.rank).length-1;
    const sameSuit=hand.filter(x=>x.suit===c.suit).map(x=>rankValue(x.rank));
    if(sameRank>=1) utility+=18*sameRank;
    for(const v of sameSuit){ if(Math.abs(v-rankValue(c.rank))===1) utility+=10; }
    if(c.rank==='A') utility+=4;
    const score=cardScore(c)*2-utility;
    if(score>bestScore){bestScore=score;best=i;}
  }
  return hand[best];
}
function botShouldDeclare(p){ return canPartition(p.hand); }
function botTakeChoice(room,p){
  const open=room.open[room.open.length-1];
  if(!open) return 'deck';
  // Take an open card when it helps a pair or adjacent same-suit sequence.
  const sameRank=p.hand.filter(c=>c.rank===open.rank).length;
  const vals=p.hand.filter(c=>c.suit===open.suit).map(c=>rankValue(c.rank));
  const ov=rankValue(open.rank);
  const adjacent=vals.some(v=>Math.abs(v-ov)===1 || (ov===1 && (v===10||v===13)) || (v===1 && (ov===10||ov===13)));
  return sameRank>0 || adjacent ? 'open' : 'deck';
}
function botPlay(room,p){
  if(room.status!=='playing' || room.players[room.turn]?.username!==p.username || p.eliminated) return;
  if(botShouldDeclare(p)){
    p.declared=true; room.status='checking'; room.declaration={username:p.username,at:Date.now()};
    addLog(room,p.username+' declared. Checking scores…'); emitRoom(room); setTimeout(()=>finishRound(room),5000); return;
  }
  const source=botTakeChoice(room,p);
  let card;
  if(source==='deck'){
    if(!room.deck.length){ if(room.open.length<=1)return; const top=room.open.pop(); room.deck=shuffle(room.open.splice(0)); room.open=[top]; }
    card=room.deck.pop(); p.picked.push('deck');
  } else {
    card=room.open.pop(); p.picked.push(card);
  }
  p.hand.push(card); p.lastAction={type:'picked',from:source,card};
  const discard=bestBotDiscard(p.hand);
  const idx=p.hand.findIndex(c=>c.id===discard.id);
  if(idx>=0){const [d]=p.hand.splice(idx,1); room.open.push(d); p.discarded.push(d); p.lastAction={type:'discarded',card:d}; addLog(room,p.username+' discarded '+d.rank+d.suit+'.');}
  nextTurn(room); emitRoom(room); scheduleBot(room);
}
function scheduleBot(room){
  if(room.status!=='playing') return;
  const p=room.players[room.turn];
  if(p && p.bot && !p.eliminated) setTimeout(()=>botPlay(room,p),700+Math.random()*900);
}
function newRound(room) {
  const deck=shuffle(makeDeck());
  room.players.forEach(p=>{ p.hand=[]; p.discarded=[]; p.picked=[]; p.declared=false; p.lastAction=null; });
  for(let i=0;i<5;i++) room.players.forEach(p=>p.hand.push(deck.pop()));
  room.deck=deck;
  room.open=[deck.pop()];
  room.turn=Math.floor(Math.random()*room.players.length);
  room.status="playing"; room.round++;
  room.declaration=null;
  room.log=[];
  addLog(room, "Round "+room.round+" started.");
}
function roomView(room, username) {
  return {
    code:room.code, host:room.host, status:room.status, mode:room.mode, round:room.round, turn:room.players[room.turn]?.username,
    deckCount:room.deck.length, openCard:publicCard(room.open[room.open.length-1]),
    players:room.players.map(p=>({
      username:p.username, bot:!!p.bot, score:p.score, eliminated:p.eliminated, connected:p.connected,
      handCount:p.hand.length, lastAction:p.lastAction ? {...p.lastAction, card:p.lastAction.card?publicCard(p.lastAction.card):null}:null,
      discarded:p.discarded.map(publicCard), picked:p.picked.map(x=>x==="deck"?"deck":publicCard(x))
    })),
    me: room.players.find(p=>p.username===username) ? {
      hand:room.players.find(p=>p.username===username).hand.map(publicCard),
      score:room.players.find(p=>p.username===username).score
    } : null,
    log:room.log.slice(-14),
    declaration:room.declaration
  };
}
function addLog(room,msg){ room.log.push({t:Date.now(),msg}); if(room.log.length>30)room.log.shift(); }
function emitRoom(room){ room.players.forEach(p=>p.socketId && io.to(p.socketId).emit("state",roomView(room,p.username))); }
function findPlayer(room,username){ return room.players.find(p=>p.username===username); }

io.use((socket,next)=>{
  try { const token=socket.handshake.auth?.token; socket.user=jwt.verify(token,JWT_SECRET); next(); }
  catch { next(new Error("Authentication required")); }
});

io.on("connection",socket=>{
  const username=socket.user.username;
  socket.on("createRoom",()=>{
    let code; do code=Math.random().toString(36).slice(2,7).toUpperCase(); while(rooms.has(code));
    const room={code,host:username,players:[],round:0,status:"lobby",deck:[],open:[],turn:0,log:[],declaration:null,mode:"friends"};
    room.players.push({username,bot:false,score:0,eliminated:false,connected:true,socketId:socket.id,hand:[],discarded:[],picked:[],declared:false,lastAction:null});
    rooms.set(code,room); socket.join(code); emitRoom(room);
  });
  socket.on("joinRoom",({code})=>{
    code=String(code||"").trim().toUpperCase(); const room=rooms.get(code);
    if(!room) return socket.emit("errorMsg","Room not found.");
    if(room.status!=="lobby") return socket.emit("errorMsg","Game already started.");
    if(room.players.length>=6) return socket.emit("errorMsg","Room is full.");
    if(findPlayer(room,username)) return socket.emit("errorMsg","Already in room.");
    room.players.push({username,bot:false,score:0,eliminated:false,connected:true,socketId:socket.id,hand:[],discarded:[],picked:[],declared:false,lastAction:null});
    socket.join(code); emitRoom(room);
  });
  socket.on("playBots",({code,count=3})=>{
    const room=rooms.get(code); if(!room) return;
    if(room.host!==username) return socket.emit("errorMsg","Only the host can add bots.");
    if(room.status!=="lobby") return socket.emit("errorMsg","Game already started.");
    const n=Math.max(1,Math.min(5,Number(count)||3));
    while(room.players.length<Math.min(6,1+n)){
      const idx=room.players.filter(p=>p.bot).length+1;
      room.players.push({username:`Bot ${idx}`,bot:true,score:0,eliminated:false,connected:true,socketId:null,hand:[],discarded:[],picked:[],declared:false,lastAction:null});
    }
    room.mode="bots";
    newRound(room); emitRoom(room); scheduleBot(room);
  });
  socket.on("startGame",({code})=>{
    const room=rooms.get(code); if(!room) return;
    if(room.host!==username) return socket.emit("errorMsg","Only the host can start.");
    if(room.players.length<2) return socket.emit("errorMsg","Need at least 2 players.");
    newRound(room); emitRoom(room); scheduleBot(room);
  });
  socket.on("drawDeck",({code})=>takeCard(code,"deck"));
  socket.on("takeOpen",({code})=>takeCard(code,"open"));
  function takeCard(code,source){
    const room=rooms.get(code); if(!room||room.status!=="playing") return;
    const p=findPlayer(room,username);
    if(!p || room.players[room.turn]?.username!==username || p.hand.length!==5) return socket.emit("errorMsg","Not your turn.");
    let card;
    if(source==="deck"){ if(!room.deck.length){ if(room.open.length<=1)return socket.emit("errorMsg","Deck is empty."); const top=room.open.pop(); room.deck=shuffle(room.open.splice(0)); room.open=[top]; } card=room.deck.pop(); p.picked.push("deck"); }
    else { if(room.open.length<1)return socket.emit("errorMsg","No open card."); card=room.open.pop(); p.picked.push(card); }
    p.hand.push(card); p.lastAction={type:"picked",from:source,card}; emitRoom(room);
  }
  socket.on("discard",({code,cardId})=>{
    const room=rooms.get(code); if(!room||room.status!=="playing") return;
    const p=findPlayer(room,username);
    if(!p || room.players[room.turn]?.username!==username || p.hand.length!==6) return socket.emit("errorMsg","Pick a card first.");
    const idx=p.hand.findIndex(c=>c.id===cardId); if(idx<0)return;
    const [card]=p.hand.splice(idx,1); room.open.push(card); p.discarded.push(card); p.lastAction={type:"discarded",card};
    addLog(room, username+" discarded "+card.rank+card.suit+".");
    room.turn=(room.turn+1)%room.players.length;
    while(room.players[room.turn].eliminated) room.turn=(room.turn+1)%room.players.length;
    emitRoom(room);
  });
  socket.on("declare",({code})=>{
    const room=rooms.get(code); if(!room||room.status!=="playing")return;
    const p=findPlayer(room,username);
    if(!p || room.players[room.turn]?.username!==username || p.hand.length!==5) return socket.emit("errorMsg","You can declare only on your turn with 5 cards.");
    if(!canPartition(p.hand)) return socket.emit("errorMsg","These 5 cards are not a valid declaration.");
    p.declared=true; room.status="checking"; room.declaration={username,at:Date.now()};
    addLog(room, username+" declared. Checking scores…");
    emitRoom(room);
    setTimeout(()=>finishRound(room),5000);
  });
  socket.on("disconnect",()=>{
    for(const room of rooms.values()){
      const p=findPlayer(room,username);
      if(p && p.socketId===socket.id){p.connected=false; p.socketId=null; emitRoom(room);}
    }
  });
});

function finishRound(room){
  if(room.status!=="checking")return;
  const declarer=findPlayer(room,room.declaration.username);
  const winner=canPartition(declarer.hand);
  const declarerScore=handScore(declarer.hand);
  room.players.forEach(p=>{
    if(p.eliminated)return;
    if(p.username===declarer.username){
      p.score += winner ? 0 : 25;
    } else {
      p.score += winner ? handScore(p.hand)-declarerScore : 0;
    }
  });
  room.status="roundOver";
  const summary=room.players.map(p=>({username:p.username,hand:p.hand.map(publicCard),discarded:p.discarded.map(publicCard),picked:p.picked.map(x=>x==="deck"?"deck":publicCard(x)),roundScore:handScore(p.hand),score:p.score}));
  room.declaration={...room.declaration,winner,summary};
  room.players.forEach(p=>{ if(p.score>=100)p.eliminated=true; });
  const alive=room.players.filter(p=>!p.eliminated);
  addLog(room, winner ? declarer.username+" won the round." : declarer.username+" declared incorrectly and gets +25.");
  if(alive.length<=1){ room.status="gameOver"; addLog(room,(alive[0]?.username||"Nobody")+" is the last player standing."); }
  emitRoom(room);
  if(room.status==="roundOver") setTimeout(()=>{newRound(room); emitRoom(room); scheduleBot(room)},5000);
}
server.listen(PORT,()=>console.log("LeastScore running on "+PORT));
