let token = localStorage.getItem("ls_token");
let socket = null;
let mode = "login";
let state = null;
let selectedIds = new Set();
let selectedSource = null;
let pendingBots = null;
let lastStateSignature = "";
let warnedTurnKey = null;

const $ = id => document.getElementById(id);
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "show";
  clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.className = "", 2600);
}
function show(which) { ["auth", "lobby", "game", "result"].forEach(x => $(x)?.classList.toggle("hidden", x !== which)); }
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
  $("roomCode").value = "";
}
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
  socket.on("connect", () => {
    toast("Connected to the table.");
    const savedRoom = localStorage.getItem("ls_room");
    if (savedRoom) socket.emit("rejoinRoom", { code: savedRoom });
  });
  socket.on("connect_error", err => { console.error(err); toast("Game server connection failed. Refresh and try again."); });
  socket.on("disconnect", () => toast("Connection lost. Reconnecting…"));
  socket.on("errorMsg", msg => {
    if (/previous room|room no longer available|not a player in that room/i.test(msg)) localStorage.removeItem("ls_room");
    toast(msg);
    if (/declare/i.test(msg)) showTurnWarning("Declare", msg);
  });
  socket.on("leftRoom", () => { state = null; selectedIds.clear(); selectedSource = null; localStorage.removeItem("ls_room"); show("lobby"); renderLobbyDefaults(); toast("You left the table."); });
  socket.on("kicked", () => { state = null; selectedIds.clear(); selectedSource = null; localStorage.removeItem("ls_room"); show("lobby"); renderLobbyDefaults(); toast("You were removed from the table by the host."); });
  socket.on("state", s => {
    const oldTurn = state?.turn;
    state = s;
    if (oldTurn !== state.turn) warnedTurnKey = null;
    if (state.code) localStorage.setItem("ls_room", state.code);
    if (state.turn !== state.me?.username || state.status !== "playing") { selectedIds.clear(); selectedSource = null; }
    if (pendingBots && state.status === "lobby" && !pendingBots.sent) {
      pendingBots.code = state.code;
      pendingBots.sent = true;
      socket.emit("playBots", { code: state.code, count: pendingBots.count, config: pendingBots.config });
    }
    render();
  });
}
function whenConnected(fn) {
  if (socket?.connected) return fn();
  toast("Connecting to game server…");
  connect();
  if (!socket) return;
  socket.once("connect", fn);
}
function createRoom(startBots = false) {
  pendingBots = startBots ? { code: null, count: Number($("botCount").value), config: configFromUI(), sent: false } : null;
  whenConnected(() => socket.emit("createRoom", { config: configFromUI() }));
}
$("create").onclick = () => createRoom(false);
$("playBots").onclick = () => createRoom(true);
$("join").onclick = () => {
  const code = $("roomCode").value.trim().toUpperCase(); if (!code) return toast("Enter the room code.");
  whenConnected(() => socket.emit("joinRoom", { code }));
};
function copyRoomCode() { if (state?.code) navigator.clipboard?.writeText(state.code).then(() => toast("Room code copied.")); }
$("copyLobbyCode").onclick = copyRoomCode;
$("copyGameCode").onclick = copyRoomCode;
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
  if (cards.length >= 2 && cards.length <= 4 && cards.every(c => c.rank === cards[0].rank)) return true;
  if (cards.length >= 3) {
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;
    const vals = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);
    if (new Set(vals).size !== vals.length) return false;
    if (vals[0] === 1) {
      if (vals[1] === 2) return vals.every((v, i) => i === 0 || v === vals[i - 1] + 1);
      return vals.length === 5 && [1, 10, 11, 12, 13].every(v => vals.includes(v));
    }
    return vals.every((v, i) => i === 0 || v === vals[i - 1] + 1);
  }
  return false;
}
function secondsLeft(deadline) { return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0; }
function showTurnWarning(title, message) {
  const modal = $("turnWarning"); if (!modal) return;
  $("turnWarningTitle").textContent = title;
  $("turnWarningText").textContent = message;
  modal.classList.remove("hidden");
  clearTimeout(window.__warningTimer);
  window.__warningTimer = setTimeout(() => modal.classList.add("hidden"), 2200);
}
$("turnWarningClose")?.addEventListener("click", () => $("turnWarning")?.classList.add("hidden"));
function updateTimers() {
  if (!state) return;
  const turnTimer = $("turnTimer");
  if (state.status === "playing" && state.turnDeadline) {
    const left = secondsLeft(state.turnDeadline);
    turnTimer.textContent = `${left}s`;
    turnTimer.classList.toggle("urgent", left <= 5);
    if (state.turn === state.me?.username && left > 0 && left <= 5) {
      const key = `${state.code}:${state.round}:${state.turn}:${state.turnStartedAt}`;
      if (warnedTurnKey !== key) {
        warnedTurnKey = key;
        showTurnWarning("Your turn", `${left} second${left === 1 ? "" : "s"} left. Make your move now.`);
      }
    }
  } else {
    turnTimer.textContent = "—";
    turnTimer.classList.remove("urgent");
  }
  const resultTimer = $("resultDealTimer");
  if (resultTimer && state.status === "roundOver" && state.dealDeadline) {
    resultTimer.textContent = `${secondsLeft(state.dealDeadline)}s`;
  }
}
setInterval(updateTimers, 250);

function updateMoveUI() {
  const myTurn = state?.status === "playing" && state?.turn === state?.me?.username;
  const move = $("move"), declare = $("declare"), deck = $("deck"), open = $("open");
  const count = selectedIds.size;
  if (move) {
    move.disabled = !myTurn || !selectedSource || count === 0;
    move.textContent = selectedSource ? `Move → ${count} card${count === 1 ? "" : "s"}` : "Choose deck / discard → Move";
  }
  if (declare) {
    declare.disabled = !state?.canDeclare;
    declare.textContent = state?.canDeclare ? "⚑ Declare" : "⚑ Declare after your first move";
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
  $("lobbyPlayers").innerHTML = state.players.map(p => `<div class="lobby-player"><span>${p.bot ? "🤖" : "●"} ${p.username}${p.username === state.me?.username ? " (you)" : ""}</span><span class="lobby-player-actions"><small>${p.bot ? "BOT" : (p.connected ? "ONLINE" : "OFFLINE")}</small>${kickButton(p)}</span></div>`).join("");
  document.querySelectorAll("#lobbyPlayers [data-kick]").forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const target = decodeURIComponent(btn.dataset.kick);
    if (confirm(`Remove ${target} from the room?`)) socket?.emit("kickPlayer", { code: state.code, target });
  });
  const isHost = state.host === state.me?.username;
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
  const canStart = state.status === "roundOver" && !!state.dealDeadline;
  deal.classList.toggle("hidden", !canStart);
  deal.disabled = !canStart;
  deal.textContent = "Start next round →";
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
  $("turnBanner").textContent = state.status === "checking" ? `⚑ ${state.declaration.username} declared — checking…` : state.status === "roundOver" ? `Round complete • ${state.dealBy} deals next` : state.status === "gameOver" ? "Game over" : mine ? "● Your turn" : `● ${state.turn}'s turn`;
  $("turnBanner").classList.toggle("mine", mine);
  const info = document.querySelector(".round-info");
  if (info) {
    const statusText = state.roundMovedByMe
      ? "You completed your first move this round. Declare is available when it is your turn."
      : "Make your first move this round. On your next turn, you can declare.";
    const first = info.querySelector(".round-rule");
    if (first) first.textContent = statusText;
  }
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
  if (!selectedSource) return toast("Choose DECK or DISCARD first.");
  const cards = (state.me?.hand || []).filter(c => selectedIds.has(c.id));
  if (!cards.length) return toast("Select at least one card to leave.");
  if (!validLeavePreview(cards)) return toast("Invalid group. Use 1 card, 2–4 same-rank cards, or 3+ consecutive cards of one suit (2-3-4, 8-9-10, 10-J-Q).");
  whenConnected(() => socket.emit("move", { code: state.code, source: selectedSource, leaveIds: [...selectedIds] }));
};
$("declare").onclick = () => {
  if (!state?.canDeclare) return toast("Complete your first move of this round. You can declare on your next turn.");
  if (!confirm("Are you sure you want to declare?")) return;
  whenConnected(() => socket.emit("declare", { code: state.code }));
};

if (token) {
  show("lobby");
  fetch("/api/me", { headers: { Authorization: "Bearer " + token } }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(j => { $("welcome").textContent = "Hi, " + j.username; connect(); }).catch(() => { localStorage.removeItem("ls_token"); token = null; show("auth"); });
}
