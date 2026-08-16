# LeastScore Online

A real-time multiplayer LeastScore card game for browsers, with private friend rooms and an offline-style bot table powered by the same server game engine.

## Features

- Username/password accounts using bcrypt + JWT
- Private 5-character rooms
- Live multiplayer synchronization with Socket.IO rooms
- 2–6 seats per table
- Play with friends or instantly fill the table with 1–5 bots
- Random first player each round
- Pick from the closed deck or the open card
- Pick → discard → Move turn flow
- Declare only on the declaring player's turn
- 5-second declaration check
- Valid arrangements:
  - Even same-rank sets (2 or 4 cards)
  - Odd same-suit sequences (3 or 5 cards)
  - A-2-3-4-5 and 10-J-Q-K-A are allowed
  - K-A-2-3-4 is not allowed
- Winner/loser round scoring and +25 penalty for an incorrect declaration
- Elimination at 100+ points; last player standing wins
- Opponent hands are never exposed during play
- Round history reveals what each player picked/discarded after the round
- Responsive premium card-table UI
- Remote background card-table photography

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy online

Deploy the folder to any Node.js host that supports a long-running web process and WebSocket/Socket.IO traffic. Set a strong `JWT_SECRET` environment variable in production.

For production persistence, replace the small JSON account store with PostgreSQL/Supabase/another database.

## Bot behavior

Bots use the same server-authoritative rules as human players. They evaluate the open card for obvious pair/sequence value, otherwise draw from the deck, discard a low-utility/high-value card, and declare when their five-card hand forms a valid arrangement.
