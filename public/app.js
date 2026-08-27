let token = localStorage.getItem("ls_token");
let socket = null;
let mode = "login";
let state = null;
let selectedIds = new Set();
let selectedSource = null;
let pendingBots = null;
let lastStateSignature = "";
let warnedTurnKey = null;
let selectedPickId = null;
let audioCtx = null;
let lastTurnKey = null;
let lastDeclareKey = null;

const $ = id => document.getElementById(id);
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "show";
  clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.className = "", 2600);
}
function show(which) { ["auth", "lobby", "game", "result"].forEach(x => $(x)?.classList.toggle("hidden", x !== which)); }
function ensureAudio() { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch {} }
function ping(freq=740,duration=.16,volume=.11) { ensureAudio(); if (!audioCtx) return; try { const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type="sine"; o.frequency.value=freq; g.gain.setValueAtTime(volume,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration); o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+duration); } catch {} }
function playTurnSound(){ ping(660,.16,.13); setTimeout(()=>ping(880,.18,.14),110); setTimeout(()=>ping(1040,.22,.11),240); }
function playDeclareSound(){ ping(520,.18,.13); setTimeout(()=>ping(760,.18,.14),120); setTimeout(()=>ping(980,.22,.12),250); }
document.addEventListener("pointerdown", ensureAudio, {once:true});
async function api(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(j.error || "Something went wrong."); return j;
}
async function enter() {
  try {
    const j = await api("/api/" + mode, { username: $("username").value, password: $("password").value });
    token = j.token; localStorage.setItem("ls_token", token); $("welcome").textContent = "Hi, " + j.username; show("lobby"); connect();
  } catch (e) { $("authMsg").textContent = e.message; }
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active")); b.classList.add("active"); mode = b.dataset.mode;
  $("authBtn").textContent = mode === "login" ? "Enter the table" : "Create my account"; $("authMsg").textContent = "";
});
$("authBtn").onclick = enter;
$("password").onkeydown = e => { if (e.key === "Enter") enter(); };
$("logout").onclick = () => { localStorage.removeItem("ls_token"); socket?.disconnect(); location.reload(); };

function renderLobbyDefaults() {
  $("lobbyRoom")?.classList.add("hidden");
  $("create")?.classList.remove("hidden");
  $("roomCode") && ($("roomCode").value = "");
  $("lobby")?.classList.remove("room-created");
}
function privateConfigFromUI() {
  return {
    targetScore: Number($("privateTarget")?.value || 100),
    turnSeconds: Number($("privateTurn")?.value || 15),
    dealSeconds: Number($("privateDeal")?.value || 15)
  };
}
function createRoom(config, startBots = false) {
  pendingBots = startBots ? { code: null, count: Number($("botCount").value), config, sent: false } : null;
  whenConnected(() => socket.emit("createRoom", { config }));
}
function openPrivateSettings(){
  $("settingsModal")?.classList.remove("hidden");
  $("privateTarget").value = "100";
  $("privateTurn").value = "15";
  $("privateDeal").value = "10";
}
$("create").onclick = openPrivateSettings;
$("closeSettings").onclick = () => $("settingsModal")?.classList.add("hidden");
$("settingsModal").onclick = e => { if(e.target === $("settingsModal")) $("settingsModal").classList.add("hidden"); };
$("createWithSettings").onclick = () => {
  $("settingsModal")?.classList.add("hidden");
  createRoom(privateConfigFromUI(), false);
};
// Solo/bot games always use the simple default settings requested.
$("playBots").onclick = () => createRoom({targetScore:100, turnSeconds:15, dealSeconds:15}, true);

$("join").onclick = () => {
  const code = $("roomCode").value.trim().toUpperCase(); if (!code) return toast("Enter the room code.");
  whenConnected(() => socket.emit("joinRoom", { code }));
};
async function copyText(text, message="Copied") {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch { toast("Copy is unavailable on this browser."); }
}
function copyRoomCode() { if (state?.code) copyText(state.code, "Copied"); }
$("copyLobbyCode").onclick = copyRoomCode;
$("copyGameCode").onclick = copyRoomCode;
function inviteUrl(code) { return `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`; }
function shareInvite() {
  if (!state?.code) return;
  const url=inviteUrl(state.code);
  const text=`Join my LeastScore game! ${url}`;
  if (navigator.share) navigator.share({title:"LeastScore game invite",text,url}).catch(()=>{});
  else copyText(text, "Invite copied");
}
$("shareLobby")?.addEventListener("click",shareInvite);
$("startGame").onclick = () => { if (state?.code) whenConnected(() => socket.emit("startGame", { code: state.code })); };
$("deal").onclick = () => { if (state?.code) whenConnected(() => socket.emit("deal", { code: state.code })); };
$("resultDeal").onclick = () => { if (state?.code) whenConnected(() => socket.emit("deal", { code: state.code })); };
$("resultExit").onclick = () => { if (!state?.code) return show("lobby"); if (confirm("Exit this game?")) socket?.emit("leaveRoom", { code: state.code }); };
$("exitGame").onclick = () => {
  if (!state?.code) return show("lobby");
  const ok = confirm("Exit this game? You can create or join another game afterwards.");
  if (!ok) return;
  if (socket?.connected) socket.emit("leaveRoom", { code: state.code });
  else { localStorage.removeItem("ls_room"); state = null; show("lobby"); renderLobbyDefaults(); }
};

function cardHTML(c) {
  const selected = selectedIds.has(c.id) ? " selected" : "";
  return `<button type="button" class="card ${c.color || ""}${selected}" data-id="${c.id}"><div class="corner">${c.rank}<br><span class="suit">${c.suit}</span></div><div class="big">${c.suit}</div></button>`;
}
function rankValue(r) { return r === "A" ? 1 : r === "J" ? 11 : r === "Q" ? 12 : r === "K" ? 13 : Number(r); }
function validLeavePreview(cards) {
  if (!cards.length) return false;
  if (cards.length === 1) return true;

  // Even same-rank groups only: 2 or 4.
  if ((cards.length === 2 || cards.length === 4) &&
      cards.every(c => c.rank === cards[0].rank)) {
    return true;
  }

  // Odd-length rank sequence; suits are intentionally ignored.
  // Supports 234, 456, 8910, 10JQ, QKA, A2345, 10JQKA.
  if (cards.length >= 3 && cards.length % 2 === 1) {
    const vals = cards.map(c => rankValue(c.rank)).sort((a,b) => a-b);
    if (new Set(vals).size !== vals.length) return false;

    if (vals.includes(1) && vals.includes(13)) {
      if (vals.length === 3 &&
          vals[0] === 1 && vals[1] === 12 && vals[2] === 13) {
        return true;
      }
      return vals.length === 5 &&
             vals.join(",") === "1,10,11,12,13";
    }

    if (vals[0] === 1) {
      return vals.every((v,i) => v === i + 1);
    }

    return vals.every((v,i) => i === 0 || v === vals[i-1] + 1);
  }

  return false;
}
function secondsLeft(deadline) {
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
}

function updateTimers() {
  if (!state) return;

  const turnTimer = $("turnTimer");
  const mine = state.status === "playing" && state.turn === state.me?.username;

  if (state.status === "playing" && state.turnDeadline) {
    const left = secondsLeft(state.turnDeadline);
    turnTimer.textContent = `${left}s`;
    turnTimer.classList.toggle("urgent", left <= 5);
    turnTimer.classList.toggle("mine-timer", mine);
  } else {
    turnTimer.textContent = "—";
    turnTimer.classList.remove("urgent", "mine-timer");
  }

  const resultTimer = $("resultDealTimer");
  if (resultTimer && state.status === "roundOver" && state.dealDeadline) {
    resultTimer.textContent = `${secondsLeft(state.dealDeadline)}s`;
  }
}
setInterval(updateTimers, 200);

function renderOpenSelectionOnly() {
  document.querySelectorAll("[data-pick-id]").forEach(el => el.classList.toggle("chosen", selectedPickId === el.dataset.pickId));
}
function updateSelectionHint() {
  const el = $("selectionHint");
  if (!el) return;
  const cards = (state?.me?.hand || []).filter(c => selectedIds.has(c.id));
  const labels = cards.map(cardLabel).join("  ");
  if (!selectedSource) el.textContent = selectedIds.size ? `Leaving ${labels}` : "Select cards to leave";
  else if (selectedSource === "deck") el.textContent = selectedIds.size ? `Leaving ${labels} • Deck` : "Deck selected";
  else el.textContent = selectedPickId ? (selectedIds.size ? `Leaving ${labels} • Pick ${cardLabel((state.openCards || []).find(c=>c.id===selectedPickId))}` : `Pick ${cardLabel((state.openCards || []).find(c=>c.id===selectedPickId))}`) : "Choose a discard card";
}
function updateMoveUI() {
  const myTurn = state?.status === "playing" && state?.turn === state?.me?.username;
  const move = $("move");
  const declare = $("declare");
  const deck = $("deck");
  const open = $("open");
  const count = selectedIds.size;

  if (move) {
    move.disabled = !myTurn || !selectedSource || count === 0;
    move.textContent = "Move";
  }

  if (declare) {
    // Keep exactly two action choices visible: Declare and Move.
    // The server decides whether Declare is legal; on the first turn it
    // returns a friendly error instead of hiding/changing the button.
    declare.disabled = !myTurn;
    declare.textContent = "Declare";
  }

  deck?.classList.toggle("chosen", selectedSource === "deck");
  open?.classList.toggle("chosen", selectedSource === "open");

  if ($("handStatus") && state?.me) {
    $("handStatus").textContent = `${count ? count + " selected • " : ""}${state.me.hand.length} cards`;
  }
  updateSelectionHint();
}function lobbyRender() {
  $("lobbyRoom")?.classList.toggle("hidden", !state.code);
  $("create")?.classList.toggle("hidden", !!state.code);
  if (!state.code) return;
  $("roomCodeDisplay").textContent = state.code;
  $("roomConfig").textContent = `Target ${state.config.targetScore} • Turn ${state.config.turnSeconds}s • Deal ${state.config.dealSeconds}s`;
  $("lobbyPlayers").innerHTML = state.players.map(p => `<div class="lobby-player"><span>${p.bot ? "🤖" : "●"} ${p.username}${p.username === state.me?.username ? " (you)" : ""}</span><span class="lobby-player-actions"><small>${p.bot ? "BOT" : (p.connected ? "ONLINE" : "OFFLINE")}</small>${kickButton(p)}</span></div>`).join("");
  document.querySelectorAll("#lobbyPlayers [data-kick]").forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const target = decodeURIComponent(btn.dataset.kick);
    if (confirm(`Remove ${target} from the room?`)) socket?.emit("kickPlayer", { code: state.code, target });
  });
  const isHost = state.host === state.me?.username;
  const shareAllowed = isHost && state.mode === "friends";
  ["shareLobby","copyLobbyCode"].forEach(id => $(id)?.classList.toggle("hidden", !shareAllowed));
  $("lobby")?.classList.toggle("room-created", !!state.code);
  const enoughPlayers = state.players.length >= 2;
  const start = $("startGame");
  start.classList.toggle("hidden", state.mode === "bots");
  start.disabled = !isHost || !enoughPlayers;
  start.textContent = enoughPlayers ? "▶ Start game" : "Waiting for 2 connected players";
  if ($("lobbyStatus")) {
    $("lobbyStatus").textContent = isHost
      ? (enoughPlayers ? "Everyone is ready. Press Start game when you want to begin." : "Share the room code. At least 2 players are required.")
      : `Waiting for ${state.host} to start the game.`;
  }
}
function cardLabel(c) { return c ? `${c.rank}${c.suit}` : "—"; }
function leftLabel(p) {
  const cards = p?.lastAction?.leftCards || [];
  return cards.length ? cards.map(cardLabel).join(" ") : "—";
}
function pickedLabel(p) {
  const m = p?.lastAction;
  if (!m) return "—";
  if (m.from === "deck" || m.picked === "deck") return "Deck";
  return m.picked ? cardLabel(m.picked) : "—";
}
function latestMoveLabel(p) {
  const m = p?.lastAction;
  if (!m) return "—";
  return `Left ${leftLabel(p)} • Picked ${pickedLabel(p)}`;
}
function kickButton(p) {
  const isHost = state.host === state.me?.username;
  if (!isHost || p.username === state.me?.username) return "";
  return `<button class="kick-btn" data-kick="${encodeURIComponent(p.username)}" type="button" title="Kick ${p.username}">Kick</button>`;
}
function renderPlayers() {
  $("players").innerHTML = state.players.map(p => {
    const a = p.lastAction?.type === "move" ? latestMoveLabel(p) : "Waiting for first move";
    return `<div class="player ${p.username === state.turn ? "active" : ""} ${p.eliminated ? "eliminated" : ""}"><div class="avatar">${p.username[0].toUpperCase()}</div><div class="pname">${p.username}${p.username === state.me?.username ? " (you)" : ""}${p.bot ? " 🤖" : ""}<br><small>${a}</small></div><div class="points">${p.score}</div></div>`;
  }).join("");
}
function renderHistoryTable() {
  const players = state.players || [];
  const html = players.map(p => `<tr class="${p.username === state.turn ? "latest-turn" : ""}"><td><b>${p.username}</b>${p.username === state.me?.username ? " <small>(you)</small>" : ""}</td><td>${leftLabel(p)}</td><td>${pickedLabel(p)}</td><td><b>${p.score}</b></td><td>${kickButton(p)}</td></tr>`).join("");
  $("historyTableBody").innerHTML = html || `<tr><td colspan="5">No players</td></tr>`;
  const mobile = $("mobileHistory");
  if (mobile) mobile.innerHTML = `<div class="mobile-table-wrap"><table><thead><tr><th>Name</th><th>Left</th><th>Picked</th><th>Score</th><th></th></tr></thead><tbody>${players.map(p => `<tr class="${p.username === state.turn ? "latest-turn" : ""}"><td><b>${p.username}</b></td><td>${leftLabel(p)}</td><td>${pickedLabel(p)}</td><td><b>${p.score}</b></td><td>${kickButton(p)}</td></tr>`).join("")}</tbody></table></div>`;
  document.querySelectorAll("[data-kick]").forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const target = decodeURIComponent(btn.dataset.kick);
    if (confirm(`Remove ${target} from the game?`)) socket?.emit("kickPlayer", { code: state.code, target });
  });
}

function renderResult() {
  show("result");
  const d = state.declaration || {};
  $("resultCode").textContent = state.code || "";
  $("resultTitle").textContent = state.status === "gameOver" ? "Game over" : "Round complete";
  $("resultWinner").textContent = d.roundWinner ? `${d.roundWinner} won this round` : "Round result";
  const rows = (d.summary || []).slice().sort((a,b) => (a.outcome === "WIN" ? -1 : 1) - (b.outcome === "WIN" ? -1 : 1) || a.score - b.score);
  $("resultTableBody").innerHTML = rows.length ? rows.map(x => `<tr class="${x.outcome === "WIN" ? "winner-row" : ""}"><td>${x.username}</td><td>${x.outcome}</td><td>${x.roundScore}</td><td>${x.score}</td></tr>`).join("") : `<tr><td colspan="4">No result available</td></tr>`;
  $("resultMessage").textContent = d.reason ? d.reason : (d.winner ? `${d.username || d.declarer || "The declarer"} declared successfully.` : `${d.username || d.declarer || "The declarer"} declared and lost the declaration.`);
  const deal = $("resultDeal");
  // Only the designated dealer gets the Start next round button.
  const canStart = !!state.canDeal && state.status === "roundOver" && !!state.dealDeadline;
  deal.classList.toggle("hidden", !canStart);
  deal.disabled = !canStart;
  deal.textContent = "Start next round";
  $("resultDealTimer").textContent = state.dealDeadline ? `${secondsLeft(state.dealDeadline)}s` : "";
}
function render() {
  if (!state) return;
  if (state.status === "lobby") { show("lobby"); lobbyRender(); return; }
  if (state.status === "roundOver" || state.status === "gameOver") { renderResult(); return; }
  show("game");
  $("game").classList.toggle("my-turn", state.status === "playing" && state.turn === state.me?.username);
  $("code").textContent = state.code; $("round").textContent = `R${state.round}`; $("myScore").textContent = state.me?.score ?? 0; $("targetScoreLabel").textContent = `Target ${state.config.targetScore}`;
  const mine = state.turn === state.me?.username;
  document.body.classList.toggle("my-turn-active", mine);
  $("turnBanner").textContent = state.status === "checking" ? `⚑ ${state.declaration.username} declared — checking…` : state.status === "roundOver" ? `Round complete • ${state.dealBy} deals next` : state.status === "gameOver" ? "Game over" : mine ? "● Your turn" : `● ${state.turn}'s turn`;
  $("turnBanner").classList.toggle("mine", mine);

  $("openCard").innerHTML = (state.openCards || []).length ? (state.openCards || []).map(c => `<div class="open-choice ${selectedPickId === c.id ? "chosen" : ""}" data-pick-id="${c.id}"><div class="open-face"><span>${c.rank}</span><b>${c.suit}</b></div></div>`).join("") : `<div class="open-empty">—</div>`;
  if (selectedPickId && !(state.openCards || []).some(c => c.id === selectedPickId)) selectedPickId = null;
  $("deckCount").textContent = state.deckCount;
  document.querySelectorAll("[data-pick-id]").forEach(el => el.onclick = () => { if (!mine) return toast("Wait for your turn."); selectedSource="open"; selectedPickId = selectedPickId === el.dataset.pickId ? null : el.dataset.pickId; updateMoveUI(); renderOpenSelectionOnly(); });
  $("hand").innerHTML = (state.me?.hand || []).map(cardHTML).join("");
  document.querySelectorAll("#hand .card").forEach(el => el.onclick = () => {
    if (!mine) return toast("Wait for your turn.");
    const id = el.dataset.id;
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    // IMPORTANT: do not validate partial selections here. A valid 3/5-card group
    // necessarily passes through temporarily invalid 2/4-card selections.
    render();
  });
  renderPlayers(); renderHistoryTable();
  if ($("roundSide")) $("roundSide").textContent = state.round || "";
  if ($("targetSide")) $("targetSide").textContent = state.config?.targetScore ?? "";
  if ($("scoreSide")) $("scoreSide").textContent = state.me?.score ?? 0;
  if ($("cardsSide")) $("cardsSide").textContent = state.me?.hand?.length ?? 0;
  $("log").innerHTML = (state.log || []).slice(-8).map(x => `<div class="logline">${x.msg}</div>`).join("");
  const result = $("roundResult");
  if (state.status === "roundOver" || state.status === "gameOver") {
    const rows = (state.declaration?.summary || []).map(x => `<tr><td>${x.username}</td><td>${x.roundScore}</td><td>${x.score}</td></tr>`).join("");
    result.classList.remove("hidden");
    result.innerHTML = `<b>${state.declaration?.winner ? "Declaration wins" : "Declaration loses (+25)"}</b><table><tr><th>Player</th><th>Round</th><th>Total</th></tr>${rows}</table>`;
  } else result.classList.add("hidden");
  $("dealPanel").classList.toggle("hidden", !state.canDeal);
  $("deal").disabled = !state.canDeal;
  updateMoveUI(); updateTimers();
}
$("deck").onclick = () => { if (state?.turn !== state?.me?.username) return toast("Wait for your turn."); selectedSource = selectedSource === "deck" ? null : "deck"; selectedPickId = null; updateMoveUI(); };
$("open").onclick = () => { if (state?.turn !== state?.me?.username) return toast("Wait for your turn."); selectedSource = "open"; updateMoveUI(); };
$("open").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("open").click(); } };
$("move").onclick = () => {
  if (state?.turn !== state?.me?.username) return toast("Wait for your turn.");
  if (!selectedSource) return toast("Choose Deck or a discard card.");
  if (selectedSource === "open" && !selectedPickId) return toast("Choose the discard card you want.");
  const cards = (state.me?.hand || []).filter(c => selectedIds.has(c.id));
  if (!cards.length) return toast("Select at least one card to leave.");
  if (!validLeavePreview(cards)) return toast("Invalid leave. Try a pair or a valid sequence.");
  whenConnected(() => socket.emit("move", { code: state.code, source: selectedSource, pickId: selectedSource === "open" ? selectedPickId : null, leaveIds: [...selectedIds] }));
};
$("declare").onclick = () => {
  if (state?.status !== "playing" || state?.turn !== state?.me?.username) return toast("Wait for your turn.");
  whenConnected(() => socket.emit("declare", { code: state.code }));
};

function joinRoomFromInvite(code) { const clean=String(code||"").trim().toUpperCase(); if(clean) whenConnected(()=>socket.emit("joinRoom",{code:clean})); }
const inviteRoom = new URLSearchParams(location.search).get("join");
if (inviteRoom && $("roomCode")) $("roomCode").value = inviteRoom.toUpperCase();

if (token) {
  show("lobby");
  fetch("/api/me", { headers: { Authorization: "Bearer " + token } }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(j => { $("welcome").textContent = "Hi, " + j.username; connect(); setTimeout(()=>{ if(inviteRoom && confirm(`Join LeastScore room ${inviteRoom.toUpperCase()}?`)) joinRoomFromInvite(inviteRoom); },500); }).catch(() => { localStorage.removeItem("ls_token"); token = null; show("auth"); });
}
