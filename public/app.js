let token = localStorage.getItem("ls_token");
let socket = null;
let mode = "login";
let state = null;
let selectedIds = new Set();
let selectedSource = null;
let pendingBots = null;
let lastStateSignature = "";

const $ = id => document.getElementById(id);
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "show";
  clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.className = "", 2600);
}
function show(which) { ["auth", "lobby", "game"].forEach(x => $(x)?.classList.toggle("hidden", x !== which)); }
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

function configFromUI() {
  return {
    targetScore: Number($("targetScore")?.value || 100),
    turnSeconds: Number($("turnSeconds")?.value || 30),
    dealSeconds: Number($("dealSeconds")?.value || 10)
  };
}
function connect() {
  if (!token || (socket && socket.connected)) return;
  socket = io({ auth: { token }, transports: ["websocket", "polling"] });
  socket.on("connect", () => toast("Connected to the table."));
  socket.on("connect_error", err => { console.error(err); toast("Game server connection failed. Refresh and try again."); });
  socket.on("disconnect", () => toast("Connection lost. Reconnecting…"));
  socket.on("errorMsg", msg => toast(msg));
  socket.on("state", s => {
    state = s;
    if (state.turn !== state.me?.username || state.status !== "playing") { selectedIds.clear(); selectedSource = null; }
    if (pendingBots && state.status === "lobby" && !pendingBots.sent) {
      pendingBots.code = state.code;
      pendingBots.sent = true;
      socket.emit("playBots", { code: state.code, count: pendingBots.count, config: pendingBots.config });
    }
    render();
  });
}
function requireSocket() {
  if (!socket || !socket.connected) { toast("Connecting to game server…"); connect(); return false; }
  return true;
}
function createRoom(startBots = false) {
  if (!requireSocket()) return;
  pendingBots = startBots ? { code: null, count: Number($("botCount").value), config: configFromUI(), sent: false } : null;
  socket.emit("createRoom", { config: configFromUI() });
}
$("create").onclick = () => createRoom(false);
$("playBots").onclick = () => createRoom(true);
$("join").onclick = () => {
  if (!requireSocket()) return;
  const code = $("roomCode").value.trim().toUpperCase(); if (!code) return toast("Enter the room code.");
  socket.emit("joinRoom", { code });
};
function copyRoomCode() { if (state?.code) navigator.clipboard?.writeText(state.code).then(() => toast("Room code copied.")); }
$("copyLobbyCode").onclick = copyRoomCode;
$("copyGameCode").onclick = copyRoomCode;
$("startGame").onclick = () => { if (state?.code) socket.emit("startGame", { code: state.code }); };
$("deal").onclick = () => { if (state?.code) socket.emit("deal", { code: state.code }); };

function cardHTML(c) {
  const selected = selectedIds.has(c.id) ? " selected" : "";
  return `<button type="button" class="card ${c.color || ""}${selected}" data-id="${c.id}"><div class="corner">${c.rank}<br><span class="suit">${c.suit}</span></div><div class="big">${c.suit}</div></button>`;
}
function rankValue(r) { return r === "A" ? 1 : r === "J" ? 11 : r === "Q" ? 12 : r === "K" ? 13 : Number(r); }
function validLeavePreview(cards) {
  if (!cards.length) return false;
  if (cards.length === 1) return true;
  if ((cards.length === 2 || cards.length === 4) && cards.every(c => c.rank === cards[0].rank)) return true;
  if (cards.length >= 3 && cards.length % 2 === 1) {
    const suit = cards[0].suit; if (!cards.every(c => c.suit === suit)) return false;
    const vals = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);
    if (new Set(vals).size !== vals.length) return false;
    if (vals.includes(1)) {
      if (vals[0] === 1 && vals[1] === 2) return vals.every((v, i) => i === 0 || v === vals[i - 1] + 1);
      return vals.length === 5 && [1, 10, 11, 12, 13].every(v => vals.includes(v));
    }
    return vals.every((v, i) => i === 0 || v === vals[i - 1] + 1);
  }
  return false;
}
function secondsLeft(deadline) { return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0; }
function updateTimers() {
  if (!state) return;
  const turnTimer = $("turnTimer");
  const dealTimer = $("dealTimer");
  if (state.status === "playing" && state.turn === state.me?.username && state.turnDeadline) {
    turnTimer.textContent = `${secondsLeft(state.turnDeadline)}s`;
    turnTimer.classList.toggle("urgent", secondsLeft(state.turnDeadline) <= 5);
  } else turnTimer.textContent = "—";
  if (state.status === "roundOver" && state.dealDeadline) {
    dealTimer.textContent = `${secondsLeft(state.dealDeadline)}s`;
    dealTimer.classList.toggle("urgent", secondsLeft(state.dealDeadline) <= 3);
  } else dealTimer.textContent = "—";
}
setInterval(updateTimers, 250);

function updateMoveUI() {
  const myTurn = state?.status === "playing" && state?.turn === state?.me?.username;
  const move = $("move"), declare = $("declare"), deck = $("deck"), open = $("open");
  const count = selectedIds.size;
  if (move) {
    move.disabled = !myTurn || !selectedSource || count === 0;
    move.textContent = selectedSource ? `Move → ${count} card${count === 1 ? "" : "s"}` : "Choose deck / open → Move";
  }
  if (declare) {
    declare.disabled = !state?.canDeclare;
    declare.textContent = state?.round === 1 ? "⚑ Declare (after R1)" : "⚑ Declare";
  }
  deck?.classList.toggle("chosen", selectedSource === "deck");
  open?.classList.toggle("chosen", selectedSource === "open");
  if ($("handStatus") && state?.me) $("handStatus").textContent = `${state.me.hand.length} cards${count ? ` • ${count} selected` : ""}`;
}
function lobbyRender() {
  $("lobbyRoom")?.classList.toggle("hidden", !state.code);
  if (!state.code) return;
  $("roomCodeDisplay").textContent = state.code;
  $("roomConfig").textContent = `Target ${state.config.targetScore} • Turn ${state.config.turnSeconds}s • Deal ${state.config.dealSeconds}s`;
  $("lobbyPlayers").innerHTML = state.players.map(p => `<div class="lobby-player"><span>${p.bot ? "🤖" : "●"} ${p.username}</span><small>${p.bot ? "BOT" : (p.connected ? "ONLINE" : "OFFLINE")}</small></div>`).join("");
  $("startGame").classList.toggle("hidden", state.host !== state.me?.username || state.mode === "bots" || state.players.length < 2);
}
function renderPlayers() {
  $("players").innerHTML = state.players.map(p => {
    const a = p.lastAction?.type === "move" ? `left ${p.lastAction.cards?.length || 0} • picked ${p.lastAction.from === "deck" ? "deck" : (p.lastAction.card?.rank || "") + (p.lastAction.card?.suit || "")}` : "waiting";
    return `<div class="player ${p.username === state.turn ? "active" : ""} ${p.eliminated ? "eliminated" : ""}"><div class="avatar">${p.username[0].toUpperCase()}</div><div class="pname">${p.username}${p.username === state.me?.username ? " (you)" : ""}${p.bot ? " 🤖" : ""}<br><small>${a}</small></div><div class="points">${p.score}</div></div>`;
  }).join("");
}
function renderHistoryTable() {
  $("historyTableBody").innerHTML = state.players.map(p => {
    const a = p.lastAction?.type === "move" ? `${p.lastAction.from === "deck" ? "Deck" : "Open"} → ${p.lastAction.card?.rank || ""}${p.lastAction.card?.suit || ""} / left ${p.lastAction.cards?.length || 0}` : "—";
    return `<tr><td>${p.username}${p.bot ? " 🤖" : ""}</td><td>${a}</td><td>${p.score}</td></tr>`;
  }).join("");
}
function render() {
  if (!state) return;
  if (state.status === "lobby") { show("lobby"); lobbyRender(); return; }
  show("game");
  $("code").textContent = state.code; $("round").textContent = `R${state.round}`; $("myScore").textContent = state.me?.score ?? 0; $("targetScoreLabel").textContent = `Target ${state.config.targetScore}`;
  const mine = state.turn === state.me?.username;
  $("turnBanner").textContent = state.status === "checking" ? `⚑ ${state.declaration.username} declared — checking…` : state.status === "roundOver" ? `Round complete • ${state.dealBy} deals next` : state.status === "gameOver" ? "Game over" : mine ? "● Your turn" : `● ${state.turn}'s turn`;
  $("turnBanner").classList.toggle("mine", mine);
  $("openCard").innerHTML = state.openCard ? cardHTML(state.openCard) : "";
  $("deckCount").textContent = state.deckCount;
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
$("deck").onclick = () => { if (state?.turn !== state?.me?.username) return toast("Wait for your turn."); selectedSource = selectedSource === "deck" ? null : "deck"; updateMoveUI(); };
$("open").onclick = () => { if (state?.turn !== state?.me?.username) return toast("Wait for your turn."); selectedSource = selectedSource === "open" ? null : "open"; updateMoveUI(); };
$("move").onclick = () => {
  if (state?.turn !== state?.me?.username) return toast("Wait for your turn.");
  if (!selectedSource) return toast("Choose DECK or OPEN first.");
  const cards = (state.me?.hand || []).filter(c => selectedIds.has(c.id));
  if (!cards.length) return toast("Select at least one card to leave.");
  if (!validLeavePreview(cards)) return toast("Invalid group. Use 1 card, 2/4 same-rank, or 3/5/7… same-suit sequence.");
  socket.emit("move", { code: state.code, source: selectedSource, leaveIds: [...selectedIds] });
};
$("declare").onclick = () => {
  if (!state?.canDeclare) return toast("Declare becomes available after the first complete round.");
  if (!confirm("Are you sure you want to declare?")) return;
  socket.emit("declare", { code: state.code });
};

if (token) {
  show("lobby");
  fetch("/api/me", { headers: { Authorization: "Bearer " + token } }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(j => { $("welcome").textContent = "Hi, " + j.username; connect(); }).catch(() => { localStorage.removeItem("ls_token"); token = null; show("auth"); });
}
