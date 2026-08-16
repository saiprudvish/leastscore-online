let token = localStorage.getItem("ls_token");
let socket;
let mode = "login";
let state = null;
let selected = null;
let pendingPick = false;

const $ = id => document.getElementById(id);

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").className = "show";
  setTimeout(() => $("toast").className = "", 2600);
}

function show(which) {
  ["auth", "lobby", "game"].forEach(x => {
    $(x).classList.toggle("hidden", x !== which);
  });
}

async function api(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const j = await r.json();

  if (!r.ok) {
    throw Error(j.error || "Something went wrong.");
  }

  return j;
}

/*
 * LOGIN / REGISTER
 */
async function enter() {
  try {
    const j = await api("/api/" + mode, {
      username: $("username").value,
      password: $("password").value
    });

    token = j.token;

    localStorage.setItem("ls_token", token);

    $("welcome").textContent = "Hi, " + j.username;

    show("lobby");

    // IMPORTANT:
    // Connect to Socket.IO immediately after login.
    connect();

  } catch (e) {
    $("authMsg").textContent = e.message;
  }
}

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => {
    document
      .querySelectorAll(".tab")
      .forEach(x => x.classList.remove("active"));

    b.classList.add("active");

    mode = b.dataset.mode;

    $("authBtn").textContent =
      mode === "login"
        ? "Enter the table"
        : "Create my account";

    $("authMsg").textContent = "";
  };
});

$("authBtn").onclick = enter;

$("password").onkeydown = e => {
  if (e.key === "Enter") {
    enter();
  }
};

$("logout").onclick = () => {
  localStorage.removeItem("ls_token");

  if (socket) {
    socket.disconnect();
  }

  location.reload();
};


/*
 * SOCKET.IO CONNECTION
 */
function connect() {

  // Don't create multiple socket connections.
  if (socket && socket.connected) {
    return;
  }

  socket = io({
    auth: {
      token: token
    },

    // Render supports WebSocket.
    // Polling is kept as a fallback.
    transports: [
      "websocket",
      "polling"
    ]
  });

  socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
    toast("Connected to the table.");
  });

  socket.on("connect_error", err => {
    console.error(
      "Socket connection failed:",
      err
    );

    toast(
      "Could not connect to game server. Please refresh."
    );
  });

  socket.on("disconnect", reason => {
    console.log(
      "Socket disconnected:",
      reason
    );

    toast(
      "Connection lost. Reconnecting…"
    );
  });

  socket.on("errorMsg", msg => {
    toast(msg);
  });

  socket.on("state", s => {
    console.log("Game state received:", s);

    state = s;

    render();
  });
}


/*
 * CREATE PRIVATE GAME
 */
$("create").onclick = () => {

  if (!socket || !socket.connected) {
    toast("Connecting to game server…");
    connect();
    return;
  }

  socket.emit("createRoom");
};


/*
 * PLAY WITH BOTS
 */
$("playBots").onclick = () => {

  if (!socket || !socket.connected) {
    toast("Connecting to game server…");
    connect();

    // Give Socket.IO a moment to connect.
    setTimeout(() => {
      if (socket && socket.connected) {
        startBots();
      } else {
        toast("Unable to connect to game server.");
      }
    }, 1000);

    return;
  }

  startBots();
};

function startBots() {

  socket.emit("createRoom");

  /*
   * The server sends the room state asynchronously.
   * Give it enough time to create the room.
   */
  setTimeout(() => {

    if (state && state.code) {

      socket.emit("playBots", {
        code: state.code,
        count: Number($("botCount").value)
      });

    } else {

      toast(
        "Room is still being created. Please try again."
      );

    }

  }, 800);
}


/*
 * JOIN FRIEND'S GAME
 */
$("join").onclick = () => {

  if (!socket || !socket.connected) {
    toast("Connecting to game server…");
    connect();
    return;
  }

  const code =
    $("roomCode").value
      .trim()
      .toUpperCase();

  if (!code) {
    toast("Enter the room code.");
    return;
  }

  socket.emit("joinRoom", {
    code: code
  });
};


/*
 * COPY ROOM CODE
 */
$("copyCode").onclick = () => {

  if (!state || !state.code) {
    return;
  }

  navigator.clipboard
    .writeText(state.code)
    .then(() => {
      toast("Room code copied.");
    })
    .catch(() => {
      toast("Could not copy room code.");
    });
};


/*
 * CARD UI
 */
function cardHTML(c, i) {

  if (!c) {
    return "";
  }

  return `
    <button
      class="card ${c.color || ""}"
      data-id="${c.id}"
      data-i="${i}"
    >
      <div class="corner">
        ${c.rank}
        <br>
        <span class="suit">${c.suit}</span>
      </div>

      <div class="big">
        ${c.suit}
      </div>
    </button>
  `;
}


/*
 * GAME RENDER
 */
function render() {

  if (!state) {
    return;
  }

  show(
    state.status === "lobby"
      ? "lobby"
      : "game"
  );

  $("code").textContent =
    state.code || "";

  $("round").textContent =
    "ROUND " + (state.round || 0);

  $("deckCount").textContent =
    state.deckCount ?? 0;

  $("myScore").textContent =
    state.me?.score ?? 0;


  /*
   * LOBBY
   */
  if (state.status === "lobby") {

    $("welcome").textContent =
      "ROOM " + state.code;

    return;
  }


  /*
   * TURN DISPLAY
   */
  if (state.status === "checking") {

    $("turnBanner").textContent =
      "⚑ " +
      state.declaration.username +
      " declared — checking…";

  } else if (state.status === "roundOver") {

    $("turnBanner").textContent =
      "Round complete — next round shortly";

  } else if (state.status === "gameOver") {

    $("turnBanner").textContent =
      "Game over";

  } else {

    $("turnBanner").textContent =
      "● " +
      state.turn +
      "'s turn";
  }


  $("turnBanner").style.color =
    state.turn === state.me?.username
      ? "#e5b65a"
      : "#b6b7b2";


  /*
   * OPEN CARD
   */
  $("openCard").innerHTML =
    state.openCard
      ? cardHTML(state.openCard, 0)
      : "";


  /*
   * MY HAND
   */
  $("hand").innerHTML =
    (state.me?.hand || [])
      .map(cardHTML)
      .join("");


  /*
   * CARD SELECTION
   */
  document
    .querySelectorAll("#hand .card")
    .forEach(el => {

      el.onclick = () => {

        selected =
          el.dataset.id;

        document
          .querySelectorAll("#hand .card")
          .forEach(x => {

            x.classList.toggle(
              "selected",
              x.dataset.id === selected
            );

          });
      };

    });


  /*
   * PLAYERS
   */
  $("players").innerHTML =
    state.players
      .map(p => {

        let action = "waiting";

        if (p.lastAction) {

          if (
            p.lastAction.from === "deck"
          ) {

            action =
              "picked from deck";

          } else if (
            p.lastAction.type === "discarded"
          ) {

            const c =
              p.lastAction.card;

            action =
              "discarded " +
              c.rank +
              c.suit;

          } else {

            action =
              "picked open";
          }
        }

        return `
          <div
            class="
              player
              ${p.username === state.turn ? "active" : ""}
              ${p.eliminated ? "eliminated" : ""}
            "
          >

            <div class="avatar">
              ${p.username[0].toUpperCase()}
            </div>

            <div class="pname">

              ${p.username}

              ${
                p.username === state.me?.username
                  ? " (you)"
                  : ""
              }

              ${
                p.bot
                  ? " 🤖"
                  : ""
              }

              <br>

              <small>
                ${action}
              </small>

            </div>

            <div class="points">
              ${p.score}
            </div>

            ${
              p.username === state.turn
                ? '<i class="turn-dot"></i>'
                : ""
            }

          </div>
        `;

      })
      .join("");


  /*
   * GAME LOG
   */
  $("log").innerHTML =
    (state.log || [])
      .map(x => `
        <div class="logline">
          ${x.msg}
        </div>
      `)
      .join("");


  /*
   * HAND STATUS
   */
  $("handStatus").textContent =
    (state.me?.hand?.length || 0) +
    " cards" +
    (
      pendingPick
        ? " • picked"
        : ""
    );


  /*
   * ROUND RESULT
   */
  if (
    state.status === "roundOver" ||
    state.status === "gameOver"
  ) {

    const summary =
      state.declaration?.summary || [];

    const rows =
      summary
        .map(x => `

          <tr>

            <td colspan="3">

              <b>
                ${x.username}
              </b>

              · round
              ${x.roundScore}

              · total
              ${x.score}

              <br>

              <small>

                Left:
                ${
                  (x.hand || [])
                    .map(
                      c =>
                        c.rank +
                        c.suit
                    )
                    .join(" ")
                }

                · Picked:

                ${
                  (x.picked || [])
                    .map(
                      c =>
                        c === "deck"
                          ? "DECK"
                          : c.rank + c.suit
                    )
                    .join(" ")
                }

                · Discarded:

                ${
                  (x.discarded || [])
                    .map(
                      c =>
                        c.rank + c.suit
                    )
                    .join(" ")
                }

              </small>

            </td>

          </tr>

        `)
        .join("");


    $("roundResult")
      .classList
      .remove("hidden");


    $("roundResult").innerHTML = `

      <h3>
        ${
          state.declaration?.winner
            ? "Declaration wins"
            : "Declaration loses (+25)"
        }
      </h3>

      <table>

        <tr>
          <th>Round details</th>
        </tr>

        ${rows}

      </table>

      ${
        state.status === "gameOver"
          ? "<p><b>🏆 Last player standing!</b></p>"
          : ""
      }

    `;

  } else {

    $("roundResult")
      .classList
      .add("hidden");

  }
}


/*
 * DRAW FROM DECK
 */
$("deck").onclick = () => {

  if (
    state?.turn !==
    state?.me?.username
  ) {

    return toast(
      "Wait for your turn."
    );
  }

  socket.emit(
    "drawDeck",
    {
      code: state.code
    }
  );

  pendingPick = true;
};


/*
 * TAKE OPEN CARD
 */
$("open").onclick = () => {

  if (
    state?.turn !==
    state?.me?.username
  ) {

    return toast(
      "Wait for your turn."
    );
  }

  socket.emit(
    "takeOpen",
    {
      code: state.code
    }
  );

  pendingPick = true;
};


/*
 * DISCARD
 */
$("move").onclick = () => {

  if (!selected) {

    return toast(
      "Select the card you want to discard."
    );
  }

  socket.emit(
    "discard",
    {
      code: state.code,
      cardId: selected
    }
  );

  selected = null;
  pendingPick = false;
};


/*
 * DECLARE
 */
$("declare").onclick = () => {

  if (!socket || !socket.connected) {
    return toast(
      "Not connected to game server."
    );
  }

  socket.emit(
    "declare",
    {
      code: state.code
    }
  );
};


/*
 * START FRIEND GAME
 */
document.addEventListener(
  "click",
  e => {

    if (
      e.target.id ===
      "startGame"
    ) {

      socket.emit(
        "startGame",
        {
          code: state.code
        }
      );

    }

  }
);


/*
 * LOBBY START PANEL
 */
const oldRender = render;

render = function () {

  oldRender();

  if (
    state?.status ===
    "lobby"
  ) {

    let lobby =
      $("lobby-wrap-start");

    if (!lobby) {

      const panel =
        document.createElement("div");

      panel.id =
        "lobby-wrap-start";

      panel.className =
        "panel";

      panel.style.marginTop =
        "16px";

      panel.innerHTML = `

        <h2>
          Room ready
        </h2>

        <p>
          Share the code above.
          The host starts when
          everyone joins.
        </p>

        <button
          id="startGame"
          class="primary"
        >
          Start game
        </button>

      `;

      document
        .querySelector(".lobby-wrap")
        .appendChild(panel);
    }
  }
};


/*
 * RESTORE EXISTING LOGIN
 *
 * If the user refreshes the page,
 * reconnect Socket.IO automatically.
 */
(async () => {

  if (token) {

    try {

      const r =
        await fetch(
          "/api/me",
          {
            headers: {
              Authorization:
                "Bearer " + token
            }
          }
        );

      if (r.ok) {

        const j =
          await r.json();

        $("welcome").textContent =
          "Hi, " + j.username;

        show("lobby");

        // IMPORTANT:
        // Reconnect after page refresh.
        connect();

      } else {

        localStorage.removeItem(
          "ls_token"
        );

        token = null;

        show("auth");
      }

    } catch (e) {

      console.error(
        "Could not restore login:",
        e
      );

      show("auth");
    }

  } else {

    show("auth");
  }

})();
