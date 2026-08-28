let token = localStorage.getItem("ls_token");
let socket = null, mode = "login", state = null, pendingBots = null;
let selectedIds = new Set(), selectedSource = null, selectedPickId = null;
let audioCtx = null, lastTurnKey = null, lastDeclarationKey = null, unreadChat = 0;

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function toast(msg){const e=$("toast");if(!e)return;e.textContent=msg;e.className="show";clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.className="",2400)}
function show(which){["auth","lobby","game","result"].forEach(x=>$(x)?.classList.toggle("hidden",x!==which))}
function ensureAudio(){try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume()}catch{}}
function ping(f=700,d=.15,v=.2){ensureAudio();if(!audioCtx)return;try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="triangle";o.frequency.value=f;g.gain.setValueAtTime(v,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+d);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+d)}catch{}}
function playTurnSound(){ping(620,.16,.22);setTimeout(()=>ping(850,.18,.2),110)}
function playDeclareSound(){ping(520,.16,.2);setTimeout(()=>ping(760,.2,.2),110);setTimeout(()=>ping(980,.23,.18),230)}
document.addEventListener("pointerdown",ensureAudio,{once:true});

async function api(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||"Something went wrong.");return j}
function whenConnected(fn){if(!socket)connect();if(socket?.connected){fn();return}const once=()=>{socket.off("connect",once);fn()};socket.once("connect",once)}

function connect(){
  if(socket?.connected||socket?.active)return socket;
  socket=io({auth:{token}});
  socket.on("connect",()=>{const saved=localStorage.getItem("ls_room");if(saved)socket.emit("rejoinRoom",{code:saved})});
  socket.on("connect_error",e=>toast(e?.message||"Unable to connect."));
  socket.on("errorMsg",m=>toast(m||"Something went wrong."));
  socket.on("kicked",()=>{localStorage.removeItem("ls_room");state=null;resetSelection();show("lobby");toast("You were removed from the table.")});
  socket.on("leftRoom",()=>{localStorage.removeItem("ls_room");state=null;resetSelection();show("lobby");renderLobbyDefaults()});
  socket.on("chatMessage",msg=>{if(!state)return;state.chat ||= [];state.chat.push(msg);if(!$("chatPanel")?.classList.contains("open")){unreadChat++;renderChatBadge()}renderChat()});
  socket.on("state",next=>{
    const prev=state;state=next;
    if(state.code)localStorage.setItem("ls_room",state.code);
    if(pendingBots&&!pendingBots.sent&&state.code&&state.status==="lobby"){pendingBots.sent=true;socket.emit("playBots",{code:state.code,count:pendingBots.count,config:pendingBots.config})}
    if(prev?.turn!==state.turn||state.status!=="playing")resetSelection();
    if(state.status==="playing"&&state.turn===state.me?.username&&prev?.turn!==state.turn)playTurnSound();
    if(state.declaration?.username&&state.declaration.username!==prev?.declaration?.username)playDeclareSound();
    render();
  });
  return socket;
}

async function enter(){try{const j=await api("/api/"+mode,{username:$("username").value,password:$("password").value});token=j.token;localStorage.setItem("ls_token",token);$("welcome").textContent="";show("lobby");connect();}catch(e){$("authMsg").textContent=e.message}}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");mode=b.dataset.mode;$("authBtn").textContent=mode==="login"?"Enter the table":"Create my account";$("authMsg").textContent=""});
$("authBtn").onclick=enter;$("password").onkeydown=e=>{if(e.key==="Enter")enter()};
$("logout").onclick=()=>{localStorage.removeItem("ls_token");localStorage.removeItem("ls_room");socket?.disconnect();location.reload()};

function renderLobbyDefaults(){$("lobbyRoom")?.classList.add("hidden");$("create")?.classList.remove("hidden");$("roomCode")&&($("roomCode").value="")}
function privateConfigFromUI(){return{targetScore:Number($("privateTarget")?.value||100),turnSeconds:Number($("privateTurn")?.value||15),dealSeconds:Number($("privateDeal")?.value||15)}}
function resetSelection(){selectedIds.clear();selectedSource=null;selectedPickId=null}
function createRoom(config,startBots=false){localStorage.removeItem("ls_room");state=null;resetSelection();pendingBots=startBots?{count:Number($("botCount").value),config,sent:false}:null;whenConnected(()=>socket.emit("createRoom",{config}))}
function openPrivateSettings(){$("settingsModal")?.classList.remove("hidden")}
$("create").onclick=openPrivateSettings;$("closeSettings").onclick=()=>$("settingsModal")?.classList.add("hidden");$("settingsModal").onclick=e=>{if(e.target===$("settingsModal"))$("settingsModal").classList.add("hidden")};
$("createWithSettings").onclick=()=>{$("settingsModal")?.classList.add("hidden");createRoom(privateConfigFromUI())};
$("playBots").onclick=()=>createRoom({targetScore:100,turnSeconds:15,dealSeconds:15},true);
$("join").onclick=()=>{const code=$("roomCode").value.trim().toUpperCase();if(!code)return toast("Enter the room code.");whenConnected(()=>socket.emit("joinRoom",{code}))};
async function copyText(t,msg="Copied"){try{await navigator.clipboard.writeText(t);toast(msg)}catch{toast("Copy is unavailable here.")}}
function copyRoomCode(){if(state?.code)copyText(state.code)}
$("copyLobbyCode").onclick=copyRoomCode;$("copyGameCode").onclick=copyRoomCode;
function shareInvite(){if(!state?.code)return;const url=`${location.origin}${location.pathname}?join=${encodeURIComponent(state.code)}`,text=`Join my LeastScore game! ${url}`;if(navigator.share)navigator.share({title:"LeastScore game invite",text,url}).catch(()=>{});else copyText(text,"Invite copied")}
$("shareLobby").onclick=shareInvite;
$("startGame").onclick=()=>{if(state?.code)whenConnected(()=>socket.emit("startGame",{code:state.code}))};
$("deal").onclick=()=>{if(state?.code)socket.emit("deal",{code:state.code})};$("resultDeal").onclick=()=>{if(state?.code)socket.emit("deal",{code:state.code})};
$("resultExit").onclick=()=>{if(state?.code)socket.emit("leaveRoom",{code:state.code});else show("lobby")};
$("exitGame").onclick=()=>{if(!state?.code)return show("lobby");socket?.emit("leaveRoom",{code:state.code})};
$("settingsGame").onclick=()=>toast("Game settings are locked after the round starts.");

function rankValue(r){return r==="A"?1:r==="J"?11:r==="Q"?12:r==="K"?13:Number(r)}
function validLeavePreview(cards){
  if(!cards.length)return false;if(cards.length===1)return true;
  if((cards.length===2||cards.length===4)&&cards.every(c=>c.rank===cards[0].rank))return true;
  if(cards.length>=3){const vals=cards.map(c=>rankValue(c.rank)).sort((a,b)=>a-b);if(new Set(vals).size!==vals.length)return false;if(vals.includes(1)&&vals.includes(13))return(vals.length===3&&vals.join(",")==="1,12,13")||(vals.length===5&&vals.join(",")==="1,10,11,12,13");if(vals[0]===1)return vals.every((v,i)=>v===i+1);return vals.every((v,i)=>i===0||v===vals[i-1]+1)}
  return false
}
function cardLabel(c){return c?`${c.rank}${c.suit}`:"—"}
function cardHTML(c){const selected=selectedIds.has(c.id)?" selected":"";return `<button type="button" class="card ${c.color||""}${selected}" data-id="${esc(c.id)}"><div class="corner">${esc(c.rank)}<span class="suit">${esc(c.suit)}</span></div><div class="big">${esc(c.suit)}</div></button>`}
function secondsLeft(d){return d?Math.max(0,Math.ceil((d-Date.now())/1000)):0}

function updateTimers(){if(!state)return;const mine=state.status==="playing"&&state.turn===state.me?.username;const e=$("turnTimer");if(state.status==="playing"&&state.turnDeadline){const left=secondsLeft(state.turnDeadline);e.textContent=`${left}s`;e.classList.toggle("urgent",left<=5)}else e.textContent="—";$("turnDot")?.classList.toggle("mine",mine);}
setInterval(updateTimers,200);

function updateSelectionUI(){
  const myTurn=state?.status==="playing"&&state.turn===state.me?.username;
  const cards=(state?.me?.hand||[]).filter(c=>selectedIds.has(c.id));
  const valid=validLeavePreview(cards);
  $("handStatus").textContent=`${state?.me?.hand?.length||0} CARDS`;
  $("selectionCount").textContent=cards.length?`${cards.length} selected${valid?"":" • invalid group"}`:"";
  const hint=$("selectionHint");
  if(!myTurn){hint.textContent=`${state?.turn||"Player"}'s turn`;return}
  if(!cards.length){hint.textContent="1. Select the cards you want to leave";}
  else if(!valid){hint.textContent="Choose 1 card, a same-rank pair, or a valid sequence";}
  else if(!selectedSource){hint.textContent="2. Choose Deck or a discard card to pick";}
  else if(selectedSource==="deck")hint.textContent=`3. Pick from DECK • leaving ${cards.map(cardLabel).join(" ")}`;
  else{const p=(state.openCards||[]).find(c=>c.id===selectedPickId);hint.textContent=p?`3. Pick ${cardLabel(p)} • then Make Move`:`3. Choose one discard card`}
  $("deck")?.classList.toggle("chosen",selectedSource==="deck");
  document.querySelectorAll(".open-choice").forEach(x=>x.classList.toggle("chosen",selectedSource==="open"&&x.dataset.pickId===selectedPickId));
  $("move").disabled=!myTurn||!valid||!selectedSource||(selectedSource==="open"&&!selectedPickId);
  $("declare").disabled=!myTurn;
}

function renderDiscard(){
  const open=$("open");const cards=state?.openCards||[];
  open.innerHTML=cards.length?cards.slice(-3).map((c,i)=>`<button type="button" class="open-choice ${c.color||""}" data-pick-id="${esc(c.id)}" style="z-index:${i+1}"><span class="rank">${esc(c.rank)}</span><span class="suit">${esc(c.suit)}</span></button>`).join(""):"<div class='open-empty'>No discard</div>";
  document.querySelectorAll(".open-choice").forEach(el=>el.onclick=e=>{e.stopPropagation();if(state?.turn!==state?.me?.username)return toast("Wait for your turn.");const cards=(state.me.hand||[]).filter(c=>selectedIds.has(c.id));if(!validLeavePreview(cards))return toast("Select a valid group to leave first.");selectedSource="open";selectedPickId=el.dataset.pickId;updateSelectionUI()});
}

function renderPlayers(){
  const players=state?.players||[];
  const html=players.map(p=>`<div class="drawer-player ${p.username===state.turn?"active":""}"><div class="avatar">${esc(p.username[0]?.toUpperCase()||"?")}</div><div><b>${esc(p.username)}${p.username===state.me?.username?" (you)":""}${p.bot?" 🤖":""}</b><small>${p.username===state.turn?"Current turn":"Last: "+(p.lastAction?latestMoveLabel(p):"Waiting")}</small></div><div class="drawer-score">${p.score}</div></div>`).join("");
  $("drawerPlayers").innerHTML=html;$("scorePlayers").textContent=players.length;
  $("mobileTableRows").innerHTML=players.map(p=>`<div class="move-row"><div class="move-avatar">${esc(p.username[0]?.toUpperCase()||"?")}</div><div class="move-main"><b>${esc(p.username)}${p.username===state.turn?" • TURN":""}</b><small>${esc(p.lastAction?latestMoveLabel(p):"Waiting for move")}</small></div><div class="move-score">${p.score}</div></div>`).join("");
}
function latestMoveLabel(p){const m=p?.lastAction;if(!m)return"Waiting";const left=(m.leftCards||[]).map(cardLabel).join(" ")||"—";const picked=m.from==="deck"||m.picked==="deck"?"Deck":cardLabel(m.picked);return `${m.automatic?"Auto • ":""}Left ${left} • Picked ${picked}`}

function lobbyRender(){
  $("lobbyRoom")?.classList.toggle("hidden",!state.code);$("create")?.classList.toggle("hidden",!!state.code);if(!state.code)return;
  $("roomCodeDisplay").textContent=state.code;$("roomConfig").textContent=`Target ${state.config.targetScore} • ${state.config.turnSeconds}s turn • ${state.config.dealSeconds}s next round`;
  const isHost=state.host===state.me?.username;
  $("lobbyPlayers").innerHTML=state.players.map(p=>`<div class="lobby-player"><span>${p.bot?"🤖":"●"} ${esc(p.username)}${p.username===state.me?.username?" (you)":""}</span><small>${p.bot?"BOT":p.connected?"ONLINE":"OFFLINE"}</small></div>`).join("");
  $("startGame").disabled=!isHost||state.players.length<2;$("lobbyStatus").textContent=isHost?(state.players.length>=2?"Everyone is ready. Start when you want.":"Share the code — at least 2 players are required."):`Waiting for ${state.host} to start the game.`;
}

function renderChat(){const box=$("chatMessages");if(!box)return;box.innerHTML=(state?.chat||[]).slice(-80).map(m=>`<div class="chat-message ${m.username===state?.me?.username?"mine":""}"><b>${esc(m.username)}</b><span>${esc(m.text)}</span></div>`).join("");box.scrollTop=box.scrollHeight}
function renderChatBadge(){const b=$("chatBadge");if(unreadChat){b.textContent=unreadChat;b.classList.remove("hidden")}else b.classList.add("hidden")}
function openChat(){$("chatPanel").classList.add("open");$("chatPanel").setAttribute("aria-hidden","false");unreadChat=0;renderChatBadge();renderChat()}
function closeChat(){$("chatPanel").classList.remove("open");$("chatPanel").setAttribute("aria-hidden","true")}
$("chatToggle").onclick=openChat;$("closeChat").onclick=closeChat;
function sendChat(){const input=$("chatInput"),text=input.value.trim();if(!text||!state?.code)return;whenConnected(()=>socket.emit("chatMessage",{code:state.code,text}));input.value=""}
$("sendChat").onclick=sendChat;$("chatInput").onkeydown=e=>{if(e.key==="Enter")sendChat()};
$("toggleTable").onclick=()=>$("tableDrawer").classList.add("open");$("closeTable").onclick=()=>$("tableDrawer").classList.remove("open");

function renderResult(){show("result");const d=state.declaration||{};$("resultTitle").textContent=state.status==="gameOver"?"Game over":"Round complete";$("resultWinner").textContent=d.roundWinner?`${esc(d.roundWinner)} won this round`:"Round result";$("resultMessage").textContent=d.reason||(d.winner?`${d.username||d.declarer||"The declarer"} declared successfully.`:`${d.username||d.declarer||"The declarer"} declared and lost.`);$("resultDealTimer").textContent=d?`${secondsLeft(state.dealDeadline)}s`:"";const rows=(d.summary||[]).slice().sort((a,b)=>(a.outcome==="WIN"?-1:1)-(b.outcome==="WIN"?-1:1)||a.score-b.score);$("resultTableBody").innerHTML=rows.map(x=>`<div class="result-row"><b>${esc(x.username)}</b><span>${x.outcome}</span><span>${x.roundScore}</span><span>${x.score}</span></div>`).join("");$("resultDeal").classList.toggle("hidden",!state.canDeal||state.status!=="roundOver")}

function render(){if(!state)return;if(state.status==="lobby"){show("lobby");lobbyRender();return}if(state.status==="roundOver"||state.status==="gameOver"){renderResult();return}show("game");const mine=state.status==="playing"&&state.turn===state.me?.username;$("turnBanner").textContent=mine?"YOUR TURN":`${state.turn||""}'S TURN`;$("turnPill")?.classList.toggle("mine",mine);$("turnDot")?.classList.toggle("mine",mine);$("round").textContent=`R${state.round}`;$("myScore").textContent=state.me?.score??0;$("targetScoreLabel").textContent=state.config?.targetScore??100;$("code").textContent=state.code||"";$("deckCount").textContent=state.deckCount??0;$("hand").innerHTML=(state.me?.hand||[]).map(cardHTML).join("");
  document.querySelectorAll("#hand .card").forEach(el=>el.onclick=()=>{if(!mine)return toast("Wait for your turn.");if(selectedSource)return toast("Pick source is already selected. Tap Deck/discard again to change it.");const id=el.dataset.id;selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id);render()});
  renderDiscard();renderPlayers();renderChat();updateSelectionUI();updateTimers();
}

$("deck").onclick=()=>{if(state?.turn!==state?.me?.username)return toast("Wait for your turn.");const cards=(state.me.hand||[]).filter(c=>selectedIds.has(c.id));if(!validLeavePreview(cards))return toast("Select a valid group to leave first.");selectedSource=selectedSource==="deck"?null:"deck";selectedPickId=null;updateSelectionUI()};
$("move").onclick=()=>{if(state?.turn!==state?.me?.username)return toast("Wait for your turn.");const cards=(state.me.hand||[]).filter(c=>selectedIds.has(c.id));if(!validLeavePreview(cards))return toast("Invalid group. Use 1 card, a pair, or a valid sequence.");if(!selectedSource)return toast("Choose Deck or a discard card first.");if(selectedSource==="open"&&!selectedPickId)return toast("Choose one discard card.");whenConnected(()=>socket.emit("move",{code:state.code,source:selectedSource,pickId:selectedSource==="open"?selectedPickId:null,leaveIds:[...selectedIds]}))};
$("declare").onclick=()=>{if(state?.status!=="playing"||state.turn!==state.me?.username)return toast("Declare only on your turn.");whenConnected(()=>socket.emit("declare",{code:state.code}))};
$("autoplay").onclick=()=>{if(state?.status!=="playing"||state.turn!==state.me?.username)return toast("Autoplay is available on your turn.");whenConnected(()=>socket.emit("autoplay",{code:state.code}))};

const inviteRoom=new URLSearchParams(location.search).get("join");if(inviteRoom&&$("roomCode"))$("roomCode").value=inviteRoom.toUpperCase();
if(token){show("lobby");fetch("/api/me",{headers:{Authorization:"Bearer "+token}}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(j=>{$("welcome").textContent=j.username;$("welcomeAvatar").textContent=j.username[0]?.toUpperCase()||"C";connect();if(inviteRoom)setTimeout(()=>{whenConnected(()=>socket.emit("joinRoom",{code:inviteRoom.toUpperCase()}))},500)}).catch(()=>{localStorage.removeItem("ls_token");token=null;show("auth")})}
