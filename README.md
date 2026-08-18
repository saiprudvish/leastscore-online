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
