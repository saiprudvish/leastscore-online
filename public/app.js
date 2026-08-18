let token=localStorage.getItem("ls_token"), socket, mode="login", state=null, selected=null, pendingPick=false;
const $=id=>document.getElementById(id);
function toast(msg){$("toast").textContent=msg;$("toast").className="show";setTimeout(()=>$("toast").className="",2600)}
function show(which){["auth","lobby","game"].forEach(x=>$(x).classList.toggle("hidden",x!==which))}
async function api(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error);return j}
async function enter(){try{let j=await api("/api/"+mode,{username:$("username").value,password:$("password").value});token=j.token;localStorage.setItem("ls_token",token);$("welcome").textContent="Hi, "+j.username;show("lobby");connect()}catch(e){$("authMsg").textContent=e.message}}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");mode=b.dataset.mode;$("authBtn").textContent=mode==="login"?"Enter the table":"Create my account";$("authMsg").textContent=""});
$("authBtn").onclick=enter;$("password").onkeydown=e=>{if(e.key==="Enter")enter()};
$("logout").onclick=()=>{localStorage.removeItem("ls_token");location.reload()};
function connect(){
  if(socket && socket.connected) return;
  socket=io({auth:{token}, transports:["websocket","polling"]});
  socket.on("connect",()=>toast("Connected to the table."));
  socket.on("connect_error",err=>{console.error("Socket connection failed",err);toast("Could not connect to game server. Please refresh.");});
  socket.on("disconnect",()=>toast("Connection lost. Reconnecting…"));
  socket.on("errorMsg",toast);
  socket.on("state",s=>{state=s;render()});
}
$("create").onclick=()=>socket.emit("createRoom");
$("playBots").onclick=()=>{socket.emit("createRoom");setTimeout(()=>{if(state?.code)socket.emit("playBots",{code:state.code,count:Number($("botCount").value)});else toast("Connecting to server… please try again.")},800)};
$("join").onclick=()=>socket.emit("joinRoom",{code:$("roomCode").value});
$("copyCode").onclick=()=>navigator.clipboard.writeText(state.code).then(()=>toast("Room code copied."));
function cardHTML(c,i){return `<button class="card ${c.color}" data-id="${c.id}" data-i="${i}"><div class="corner">${c.rank}<br><span class="suit">${c.suit}</span></div><div class="big">${c.suit}</div></button>`}
function render(){if(!state)return;show(state.status==="lobby"?"lobby":"game");$("code").textContent=state.code;$("round").textContent="ROUND "+state.round;$("deckCount").textContent=state.deckCount;$("myScore").textContent=state.me?.score??0;
if(state.status==="lobby"){ $("welcome").textContent="ROOM "+state.code; return; }
$("turnBanner").textContent=state.status==="checking"?"⚑ "+state.declaration.username+" declared — checking…":state.status==="roundOver"?"Round complete — next round shortly":state.status==="gameOver"?"Game over":"● "+state.turn+"'s turn";
$("turnBanner").style.color=state.turn===state.me?.username?"#e5b65a":"#b6b7b2";
$("openCard").innerHTML=state.openCard?cardHTML(state.openCard,0):"";
$("hand").innerHTML=(state.me?.hand||[]).map(cardHTML).join("");
document.querySelectorAll("#hand .card").forEach(el=>el.onclick=()=>{selected=el.dataset.id;document.querySelectorAll("#hand .card").forEach(x=>x.classList.toggle("selected",x.dataset.id===selected))});
$("players").innerHTML=state.players.map(p=>`<div class="player ${p.username===state.turn?"active":""} ${p.eliminated?"eliminated":""}"><div class="avatar">${p.username[0].toUpperCase()}</div><div class="pname">${p.username}${p.username===state.me?.username?" (you)":""}${p.bot?" 🤖":""}<br><small>${p.lastAction?(p.lastAction.from==="deck"?"picked from deck":p.lastAction.type==="discarded"?"discarded "+p.lastAction.card.rank+p.lastAction.card.suit:"picked open"):"waiting"}</small></div><div class="points">${p.score}</div>${p.username===state.turn?'<i class="turn-dot"></i>':''}</div>`).join("");
$("log").innerHTML=state.log.map(x=>`<div class="logline">${x.msg}</div>`).join("");
$("handStatus").textContent=(state.me?.hand?.length||0)+" cards"+(pendingPick?" • picked":"");
if(state.status==="roundOver"||state.status==="gameOver"){let rows=state.declaration.summary.map(x=>`<tr><td colspan="3"><b>${x.username}</b> · round ${x.roundScore} · total ${x.score}<br><small>Left: ${(x.hand||[]).map(c=>c.rank+c.suit).join(" ")} · Picked: ${(x.picked||[]).map(c=>c==="deck"?"DECK":c.rank+c.suit).join(" ")} · Discarded: ${(x.discarded||[]).map(c=>c.rank+c.suit).join(" ")}</small></td></tr>`).join("");$("roundResult").classList.remove("hidden");$("roundResult").innerHTML=`<h3>${state.declaration.winner?"Declaration wins":"Declaration loses (+25)"}</h3><table><tr><th>Round details</th></tr>${rows}</table>${state.status==="gameOver"?'<p><b>🏆 Last player standing!</b></p>':''}`}else $("roundResult").classList.add("hidden");
}
$("deck").onclick=()=>{if(state?.turn!==state?.me?.username)return toast("Wait for your turn.");socket.emit("drawDeck",{code:state.code});pendingPick=true};
$("open").onclick=()=>{if(state?.turn!==state?.me?.username)return toast("Wait for your turn.");socket.emit("takeOpen",{code:state.code});pendingPick=true};
$("move").onclick=()=>{if(!selected)return toast("Select the card you want to discard.");socket.emit("discard",{code:state.code,cardId:selected});selected=null;pendingPick=false};
$("declare").onclick=()=>socket.emit("declare",{code:state.code});
document.addEventListener("click",e=>{if(e.target.id==="startGame")socket.emit("startGame",{code:state.code})});
const oldRender=render;
render=function(){oldRender();if(state?.status==="lobby"){let lobby=$("lobby-wrap-start");if(!lobby){const panel=document.createElement("div");panel.id="lobby-wrap-start";panel.className="panel";panel.style.marginTop="16px";panel.innerHTML='<h2>Room ready</h2><p>Share the code above. The host starts when everyone joins.</p><button id="startGame" class="primary">Start game</button>';document.querySelector(".lobby-wrap").appendChild(panel)}}};
(async()=>{if(token){try{let r=await fetch("/api/me",{headers:{Authorization:"Bearer "+token}});if(r.ok){let j=await r.json();$("welcome").textContent="Hi, "+j.username;show("lobby");connect()}else show("auth")}catch{show("auth")}}else show("auth")})();
