# LeastScore — online multiplayer

A mobile-first real-time card game based on your LeastScore rules and the reference screenshot/video.

## Included
- Username/password registration and login.
- Private 5-character room codes.
- 2–6 players.
- Random first player each round.
- Five cards dealt to every player.
- Pick from closed deck or open card.
- Six-card turn state, then discard one to finish.
- Valid declaration checking:
  - even-of-a-kind groups (2 or 4 of a rank)
  - odd same-suit sequences (3 or 5)
  - A2345 and 10JQKA are allowed; KA234 is rejected.
- Five-second declaration review.
- Winner scoring: each opponent adds `their round score - declarer's score`.
- Losing declaration: declarer gets +25.
- 100+ points eliminates a player.
- Round continues until one player remains.
- Players see scores and public pick/discard history, but never another player's five cards.
- Mobile-first UI matching the supplied LeastScore reference screenshots.
- Scrollable game screen with clean turn/timer treatment.
- Multi-select hand cards visibly lift/highlight before choosing Deck or a discard card.
- Up to three discard choices are shown as real cards; no large "cards left" panel.
- Floating in-game chat bottom sheet.
- Server-validated Autoplay button for the current player.
- No red/green turn background takeover; state is communicated with compact indicators.

## Run locally
1. Install Node.js 18+.
2. `npm install`
3. `JWT_SECRET="use-a-long-random-secret" npm start`
4. Open `http://localhost:3000`.

For friends on the internet, deploy the folder to a Node-compatible host such as Render, Railway, Fly.io, or your own VPS. Use a persistent disk/DB for production user storage; this starter stores accounts in `users.json` and live games in memory.

## Important production upgrades
- Use PostgreSQL/Supabase for users, rooms and game state.
- Use HTTPS/WSS.
- Add rate limiting and password reset/email verification.
- Persist active rooms if you need games to survive server restarts.
- The remote Unsplash image is used only as the visual background; you can replace its URL in `styles.css`.
