# LeastScore Online — fixed multiplayer build

This build fixes the game flow and mobile UI around the latest requirements:

- Single-card and multi-card selection works. Partial selections are allowed while building a valid group.
- Move validates on the server, replaces the picked card, updates the hand, records the move, and advances the turn.
- Declare is locked during round 1 and unlocks only after round 1 completes.
- After a declaration, the next active player receives the Deal button and countdown. If they do not press it, the next round starts automatically.
- Turn timeout is server-side and performs an automatic random-card move.
- Target score is configurable: 50 / 100 / 150.
- Turn time is configurable up to 30 seconds.
- Deal countdown is configurable: 5 / 10 seconds.
- Multiplayer rooms use Socket.IO and the server is authoritative for moves, turns, scores and timers.
- Bot mode uses the same server game engine.
- Mobile game view is designed to fit cards, controls, timers and the player/move table on one screen without page scrolling.

## Render

Build command:

```bash
npm install
```

Start command:

```bash
node server.js
```

`npm start` is also equivalent because `package.json` defines it as `node server.js`.

Set a strong `JWT_SECRET` environment variable in production.


## v3 functional fixes

- Restored the current player's username in the server state; this fixes card selection, Move, Declare and host Start controls.
- Round 1 now completes after every active player has made one move; Declare unlocks only after that.
- Discarded cards are added to the OPEN pile and the next player's state is broadcast immediately.
- Added reconnect/rejoin support for the current room.
- Friends lobby now shows a Start Game control to the host and a waiting message to guests.
- Mobile lobby is vertically scrollable; the game table remains a single-screen, non-scrolling layout.
- Turn and deal timers remain server-authoritative, with automatic actions on timeout.
- Target score, turn time and deal time remain configurable.

### Validation

`node --check server.js` and `node --check public/app.js` pass. A mocked server-side game flow was also run covering initial deal, four-player first-round moves, OPEN pile update, Round 1 declaration unlock and declaration.
