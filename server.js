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

function saveUsers() { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); }
function tokenFor(username) { return jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" }); }
function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Please login again." }); }
}
app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,18}$/.test(username)) return res.status(400).json({ error: "Username: 3–18 letters, numbers or _." });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (users[username]) return res.status(409).json({ error: "Username already exists." });
  users[username] = { password: await bcrypt.hash(password, 10), createdAt: Date.now() };
  saveUsers();
  res.json({ token: tokenFor(username), username });
});
app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!users[username] || !(await bcrypt.compare(password, users[username].password))) return res.status(401).json({ error: "Invalid username or password." });
  res.json({ token: tokenFor(username), username });
});
app.get("/api/me", auth, (req, res) => res.json({ username: req.user.username }));

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const rankValue = r => r === "A" ? 1 : r === "J" ? 11 : r === "Q" ? 12 : r === "K" ? 13 : Number(r);
function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: r + s, rank: r, suit: s });
  return deck;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function cardScore(c) { return rankValue(c.rank); }
function color(s) { return (s === "♥" || s === "♦") ? "red" : "black"; }
function publicCard(c) { return c ? { id: c.id, rank: c.rank, suit: c.suit, color: color(c.suit) } : null; }
function handScore(hand) { return hand.reduce((n, c) => n + cardScore(c), 0); }

// A leave group is either 2/4 cards of one rank or an odd same-suit sequence.
function validLeaveGroup(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return true;
  if (cards.length === 1) return true;
  if ((cards.length === 2 || cards.length === 4) && cards.every(c => c.rank === cards[0].rank)) return true;
  if (cards.length >= 3 && cards.length % 2 === 1) {
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;
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
function findLeaveGroups(hand) {
  const groups = [[]];
  const byRank = {};
  hand.forEach(c => (byRank[c.rank] ??= []).push(c));
  Object.values(byRank).forEach(g => {
    if (g.length >= 2) groups.push(g.slice(0, 2));
    if (g.length >= 4) groups.push(g.slice(0, 4));
  });
  for (const suit of SUITS) {
    const cards = hand.filter(c => c.suit === suit).sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 2; j < cards.length; j++) {
        const g = cards.slice(i, j + 1);
        if (g.length % 2 === 1 && validLeaveGroup(g)) groups.push(g);
      }
    }
    const high = ["10", "J", "Q", "K", "A"].map(r => cards.find(c => c.rank === r)).filter(Boolean);
    if (high.length === 5) groups.push(high);
  }
  return groups;
}
function bestLeaveGroup(hand) {
  const groups = findLeaveGroups(hand).filter(g => g.length);
  groups.sort((a, b) => b.length - a.length || handScore(a) - handScore(b));
  return groups[0] || [];
}
function randomLeaveGroup(hand) {
  const groups = findLeaveGroups(hand).filter(g => g.length);
  return groups.length ? groups[Math.floor(Math.random() * groups.length)] : (hand.length ? [hand[Math.floor(Math.random() * hand.length)]] : []);
}
function isBot(p) { return !!p.bot; }
function findPlayer(room, username) { return room.players.find(p => p.username === username); }
function activePlayers(room) { return room.players.filter(p => !p.eliminated); }
function nextActiveIndex(room, fromIndex) {
  for (let i = 1; i <= room.players.length; i++) {
    const idx = (fromIndex + i) % room.players.length;
    if (!room.players[idx].eliminated) return idx;
  }
  return fromIndex;
}
function nextTurn(room) { room.turn = nextActiveIndex(room, room.turn); }
function addLog(room, msg) { room.log.push({ t: Date.now(), msg }); if (room.log.length > 40) room.log.shift(); }
function emitRoom(room) { room.players.forEach(p => p.socketId && io.to(p.socketId).emit("state", roomView(room, p.username))); }

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}
function startTurnTimer(room) {
  clearTurnTimer(room);
  if (room.status !== "playing") return;
  room.turnStartedAt = Date.now();
  room.turnDeadline = room.turnStartedAt + room.config.turnSeconds * 1000;
  const token = ++room.timerToken;
  room.turnTimer = setTimeout(() => {
    if (token !== room.timerToken || room.status !== "playing") return;
    const p = room.players[room.turn];
    if (!p || p.eliminated) return;
    addLog(room, `${p.username} timed out — automatic move.`);
    performMove(room, p, Math.random() < 0.5 ? "deck" : "open", p.hand.length ? [p.hand[Math.floor(Math.random() * p.hand.length)]] : [], true);
  }, room.config.turnSeconds * 1000 + 80);
}
function recycleDeck(room) {
  if (room.open.length <= 1) return false;
  const top = room.open.pop();
  room.deck = shuffle(room.open.splice(0));
  room.open = [top];
  return true;
}
function drawCard(room, source) {
  if (source === "deck") {
    if (!room.deck.length) recycleDeck(room);
    return room.deck.pop() || null;
  }
  return room.open.pop() || null;
}
function performMove(room, p, source, leaving, automatic = false) {
  if (room.status !== "playing" || room.players[room.turn] !== p || p.eliminated) return false;
  if (source !== "deck" && source !== "open") return false;
  if (!Array.isArray(leaving)) leaving = [];
  const unique = [...new Set(leaving.map(c => c.id))];
  const cards = unique.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
  if (cards.length !== unique.length || !validLeaveGroup(cards)) return false;
  const picked = drawCard(room, source);
  if (!picked) return false;

  cards.forEach(c => {
    const idx = p.hand.findIndex(x => x.id === c.id);
    if (idx >= 0) p.hand.splice(idx, 1);
    p.left.push(c);
  });
  // The cards left by the player become the discard/open pile. The last
  // selected card is therefore the visible OPEN card, while the earlier
  // cards remain underneath it.
  cards.forEach(c => room.open.push(c));
  p.hand.push(picked);
  p.picked.push(source === "deck" ? "deck" : picked);
  p.lastAction = { type: "move", from: source, card: picked, cards };
  room.roundMovedBy.add(p.username);
  if (room.round === 1) {
    const active = activePlayers(room);
    room.roundReady = active.length > 0 && active.every(x => room.roundMovedBy.has(x.username));
  }
  addLog(room, `${p.username}${cards.length ? ` left ${cards.map(c => c.rank + c.suit).join(" ")} and ` : " "}${source === "deck" ? "picked from deck" : `picked ${picked.rank}${picked.suit}`}${automatic ? " (auto)" : ""}.`);
  clearTurnTimer(room);
  nextTurn(room);
  emitRoom(room);
  startTurnTimer(room);
  scheduleBot(room);
  return true;
}
function botTakeChoice(room, p) {
  const open = room.open[room.open.length - 1];
  if (!open) return "deck";
  const sameRank = p.hand.filter(c => c.rank === open.rank).length;
  const vals = p.hand.filter(c => c.suit === open.suit).map(c => rankValue(c.rank));
  const ov = rankValue(open.rank);
  const adjacent = vals.some(v => Math.abs(v - ov) === 1 || (ov === 1 && (v === 10 || v === 13)) || (v === 1 && (ov === 10 || ov === 13)));
  return sameRank > 0 || adjacent ? "open" : "deck";
}
function scheduleBot(room) {
  if (room.status !== "playing") return;
  const p = room.players[room.turn];
  if (p && p.bot && !p.eliminated) {
    const token = room.timerToken;
    setTimeout(() => {
      if (room.status !== "playing" || room.timerToken !== token || room.players[room.turn] !== p) return;
      if ((room.round > 1 || room.roundReady) && (p.hand.length <= 3 || handScore(p.hand) <= 8)) return declarePlayer(room, p, true);
      const source = botTakeChoice(room, p);
      performMove(room, p, source, bestLeaveGroup(p.hand), false);
    }, 650 + Math.random() * 900);
  }
}

function resetRoundPlayer(p) {
  p.hand = []; p.left = []; p.picked = []; p.declared = false; p.lastAction = null;
}
function newRound(room) {
  clearTurnTimer(room);
  const deck = shuffle(makeDeck());
  room.players.forEach(resetRoundPlayer);
  for (let i = 0; i < 5; i++) room.players.forEach(p => { if (!p.eliminated) p.hand.push(deck.pop()); });
  room.deck = deck;
  room.open = [room.deck.pop()];
  room.round += 1;
  room.status = "playing";
  room.roundReady = false;
  room.roundMovedBy = new Set();
  room.declaration = null;
  room.dealBy = null;
  room.dealDeadline = null;
  room.log = [];
  room.turn = room.players.findIndex(p => !p.eliminated);
  if (room.turn < 0) room.turn = 0;
  addLog(room, `Round ${room.round} started. ${room.players[room.turn]?.username || ""} goes first.`);
  emitRoom(room);
  startTurnTimer(room);
  scheduleBot(room);
}
function roomView(room, username) {
  const me = findPlayer(room, username);
  return {
    code: room.code, host: room.host, status: room.status, mode: room.mode, round: room.round,
    turn: room.players[room.turn]?.username,
    deckCount: room.deck.length,
    openCard: publicCard(room.open[room.open.length - 1]),
    config: room.config,
    roundReady: room.roundReady,
    turnStartedAt: room.turnStartedAt,
    turnDeadline: room.turnDeadline,
    dealBy: room.dealBy,
    dealDeadline: room.dealDeadline,
    canDeclare: (room.round > 1 || room.roundReady) && room.status === "playing" && room.turn === room.players.findIndex(p => p.username === username),
    canDeal: room.status === "roundOver" && room.dealBy === username,
    players: room.players.map(p => ({
      username: p.username, bot: !!p.bot, score: p.score, eliminated: p.eliminated, connected: p.connected,
      handCount: p.hand.length,
      lastAction: p.lastAction ? {
        ...p.lastAction,
        card: p.lastAction.card ? publicCard(p.lastAction.card) : null,
        cards: p.lastAction.cards ? p.lastAction.cards.map(publicCard) : []
      } : null
    })),
    me: me ? { username: me.username, hand: me.hand.map(publicCard), score: me.score } : null,
    log: room.log.slice(-18),
    declaration: room.declaration
  };
}

function declarePlayer(room, p, automatic = false) {
  if (room.status !== "playing" || (!room.roundReady && room.round <= 1) || room.players[room.turn] !== p || p.eliminated) return false;
  clearTurnTimer(room);
  p.declared = true;
  room.status = "checking";
  room.declaration = { username: p.username, at: Date.now(), automatic };
  addLog(room, `${p.username}${automatic ? " automatically" : ""} declared. Checking scores…`);
  emitRoom(room);
  setTimeout(() => finishRound(room), 1200);
  return true;
}
function beginDealWindow(room) {
  const next = room.players[room.dealByIndex];
  if (!next) return newRound(room);
  room.status = "roundOver";
  room.dealBy = next.username;
  room.dealDeadline = Date.now() + room.config.dealSeconds * 1000;
  emitRoom(room);
  const token = ++room.timerToken;
  if (next.bot) {
    setTimeout(() => { if (room.status === "roundOver" && room.timerToken === token) startNextRound(room); }, 900);
  } else {
    setTimeout(() => {
      if (room.status === "roundOver" && room.timerToken === token && Date.now() >= room.dealDeadline) {
        addLog(room, `${room.dealBy} did not press Deal — starting automatically.`);
        startNextRound(room);
      }
    }, room.config.dealSeconds * 1000 + 80);
  }
}
function startNextRound(room) {
  if (room.status !== "roundOver") return;
  room.timerToken++;
  newRound(room);
}
function finishRound(room) {
  if (room.status !== "checking") return;
  const declarer = findPlayer(room, room.declaration.username);
  if (!declarer) return;
  const declarerScore = handScore(declarer.hand);
  const others = activePlayers(room).filter(p => p.username !== declarer.username);
  const winner = declarerScore <= Math.min(...others.map(p => handScore(p.hand)), Infinity);
  room.players.forEach(p => {
    if (p.eliminated) return;
    const score = handScore(p.hand);
    if (p.username === declarer.username) p.score += winner ? 0 : 25;
    else p.score += winner ? Math.max(0, score - declarerScore) : 0;
  });
  const target = room.config.targetScore;
  room.players.forEach(p => { if (p.score >= target) p.eliminated = true; });
  room.status = "roundOver";
  room.declaration = {
    ...room.declaration,
    winner,
    declarerScore,
    summary: room.players.map(p => ({ username: p.username, hand: p.hand.map(publicCard), left: p.left.map(publicCard), picked: p.picked.map(x => x === "deck" ? "deck" : publicCard(x)), roundScore: handScore(p.hand), score: p.score }))
  };
  addLog(room, winner ? `${declarer.username} won the declaration.` : `${declarer.username} lost the declaration and gets +25.`);
  const alive = activePlayers(room);
  if (alive.length <= 1) {
    room.status = "gameOver";
    clearTurnTimer(room);
    emitRoom(room);
    return;
  }
  room.dealByIndex = nextActiveIndex(room, room.players.findIndex(p => p.username === declarer.username));
  beginDealWindow(room);
}

function normalizedConfig(raw) {
  const targetScore = Number(raw?.targetScore);
  const turnSeconds = Number(raw?.turnSeconds);
  const dealSeconds = Number(raw?.dealSeconds);
  return {
    targetScore: [50, 100, 150].includes(targetScore) ? targetScore : 100,
    turnSeconds: Math.min(30, Math.max(5, Number.isFinite(turnSeconds) ? turnSeconds : 30)),
    dealSeconds: Math.min(10, Math.max(3, Number.isFinite(dealSeconds) ? dealSeconds : 10))
  };
}
function makeRoom(host, config) {
  return {
    code: "", host, players: [], round: 0, status: "lobby", deck: [], open: [], turn: 0, log: [], declaration: null,
    mode: "friends", config: normalizedConfig(config), turnStartedAt: null, turnDeadline: null,
    dealBy: null, dealByIndex: 0, dealDeadline: null, turnTimer: null, timerToken: 0,
    roundReady: false, roundMovedBy: new Set()
  };
}

io.use((socket, next) => {
  try { const token = socket.handshake.auth?.token; socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error("Authentication required")); }
});

io.on("connection", socket => {
  const username = socket.user.username;

  socket.on("createRoom", ({ config } = {}) => {
    let code; do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(code));
    const room = makeRoom(username, config);
    room.code = code;
    room.players.push({ username, bot: false, score: 0, eliminated: false, connected: true, socketId: socket.id, hand: [], left: [], picked: [], declared: false, lastAction: null });
    rooms.set(code, room); socket.join(code); emitRoom(room);
  });

  socket.on("joinRoom", ({ code } = {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMsg", "Room not found. Check the 5-character code.");
    const existing = findPlayer(room, username);
    if (existing) {
      if (existing.bot) return socket.emit("errorMsg", "That username is already used by a bot.");
      existing.connected = true;
      existing.socketId = socket.id;
      socket.join(code);
      emitRoom(room);
      return;
    }
    if (room.status !== "lobby") return socket.emit("errorMsg", "Game already started. You cannot join this room now.");
    if (room.players.length >= 6) return socket.emit("errorMsg", "Room is full.");
    room.players.push({ username, bot: false, score: 0, eliminated: false, connected: true, socketId: socket.id, hand: [], left: [], picked: [], declared: false, lastAction: null });
    socket.join(code); emitRoom(room);
  });

  socket.on("rejoinRoom", ({ code } = {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMsg", "Your previous room is no longer available.");
    const p = findPlayer(room, username);
    if (!p || p.bot) return socket.emit("errorMsg", "You are not a player in that room.");
    p.connected = true;
    p.socketId = socket.id;
    socket.join(code);
    emitRoom(room);
  });

  socket.on("playBots", ({ code, count = 3, config } = {}) => {
    const room = rooms.get(code); if (!room) return;
    if (room.host !== username) return socket.emit("errorMsg", "Only the host can add bots.");
    if (room.status !== "lobby") return socket.emit("errorMsg", "Game already started.");
    if (config) room.config = normalizedConfig(config);
    const n = Math.max(1, Math.min(5, Number(count) || 3));
    while (room.players.length < Math.min(6, 1 + n)) {
      const idx = room.players.filter(p => p.bot).length + 1;
      room.players.push({ username: `Bot ${idx}`, bot: true, score: 0, eliminated: false, connected: true, socketId: null, hand: [], left: [], picked: [], declared: false, lastAction: null });
    }
    room.mode = "bots";
    newRound(room);
  });

  socket.on("startGame", ({ code } = {}) => {
    const room = rooms.get(code); if (!room) return;
    if (room.host !== username) return socket.emit("errorMsg", "Only the host can start.");
    if (room.players.length < 2) return socket.emit("errorMsg", "Need at least 2 players.");
    newRound(room);
  });

  socket.on("move", ({ code, source, leaveIds = [] } = {}) => {
    const room = rooms.get(code);
    if (!room || room.status !== "playing") return socket.emit("errorMsg", "This round is not accepting moves.");
    const p = findPlayer(room, username);
    if (!p || p.eliminated || room.players[room.turn]?.username !== username) return socket.emit("errorMsg", "Wait for your turn.");
    const ids = [...new Set(Array.isArray(leaveIds) ? leaveIds.map(String) : [])];
    const leaving = ids.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
    if (leaving.length !== ids.length) return socket.emit("errorMsg", "One or more selected cards are not in your hand.");
    if (!validLeaveGroup(leaving)) return socket.emit("errorMsg", "Invalid group. Use 2/4 same-rank or 3/5/7… same-suit sequence.");
    if (!performMove(room, p, source, leaving)) return socket.emit("errorMsg", "Move could not be completed. Try again.");
  });

  socket.on("declare", ({ code } = {}) => {
    const room = rooms.get(code); if (!room || room.status !== "playing") return;
    const p = findPlayer(room, username);
    if (room.round <= 1) return socket.emit("errorMsg", "Declare becomes available after the first complete round.");
    if (!p || p.eliminated || room.players[room.turn]?.username !== username) return socket.emit("errorMsg", "Declare only on your turn.");
    if (!declarePlayer(room, p)) socket.emit("errorMsg", "Declare is not available right now.");
  });

  socket.on("deal", ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room || room.status !== "roundOver") return socket.emit("errorMsg", "No deal is waiting right now.");
    if (room.dealBy !== username) return socket.emit("errorMsg", `Waiting for ${room.dealBy} to deal.`);
    startNextRound(room);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const p = findPlayer(room, username);
      if (p && p.socketId === socket.id) { p.connected = false; p.socketId = null; emitRoom(room); }
    }
  });
});

server.listen(PORT, () => console.log("LeastScore running on " + PORT));
