# LeastScore v16 — interaction-fixed mobile UI

This build is based on the previous LeastScore v15 code and keeps the existing game/server logic while fixing the broken interaction flow.

## Fixed in v16
- Hand cards use delegated click handling, so they remain clickable after every real-time state re-render.
- Card selection can be changed freely; selecting a card clears the old pick-source choice so the move flow stays consistent.
- Deck and discard cards are real touch buttons.
- Make Move and Declare are wired to the server with connection handling.
- Autoplay is now a toggle: when ON, the player's turn automatically triggers a server-validated autoplay move.
- Autoplay always draws from the deck; timeout auto-play also draws from the deck.
- Back / Exit now reliably leave the current room and return to the lobby, including a top-right Exit button.
- Static assets are served with `no-store` and the app script is cache-busted as `app.js?v=16`, preventing old JavaScript from staying in the browser/Render cache.
- Chat, table drawer, lobby controls, result controls and game actions remain connected.
- Mobile touch handling was strengthened for cards and action buttons.

## Run
1. Node.js 18+
2. `npm install`
3. `JWT_SECRET="use-a-long-random-secret" npm start`
4. Open `http://localhost:3000`

## Render
Use the folder contents as the service root. Start command:
`npm start`

No database is required for the current starter; accounts are stored in `users.json` and live rooms are kept in memory.


V19 changes: Guest play, Google sign-in removed, robust card touch/click controls, immediate Back/Exit, redesigned full-size card faces, cache version v19.
