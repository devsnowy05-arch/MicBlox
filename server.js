const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const players = new Map();
const servers = new Map();

function auth(req, res, next) {
    if (!API_KEY) return next();

    if (req.headers["x-api-key"] !== API_KEY) {
        return res.status(401).json({
            success: false,
            error: "unauthorized"
        });
    }

    next();
}

function token() {
    return crypto.randomBytes(24).toString("hex");
}

function getPlayer(id) {
    return players.get(String(id));
}

function getServerPlayers(serverId) {
    const result = [];

    for (const player of players.values()) {
        if (player.server === serverId) {
            result.push(player);
        }
    }

    return result;
}

function publicPlayer(player) {
    return {
        token: player.token,
        user: player.user,
        username: player.username,
        x: player.x,
        y: player.y,
        z: player.z,
        micEnabled: player.micEnabled,
        muted: player.muted,
        browserConnected: player.browserConnected
    };
}

function broadcast(serverId, message) {
    const data = JSON.stringify(message);

    for (const player of getServerPlayers(serverId)) {
        if (
            player.ws &&
            player.ws.readyState === WebSocket.OPEN
        ) {
            try {
                player.ws.send(data);
            } catch {}
        }
    }
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

/* =========================
   STATUS
========================= */

app.get("/api", (req, res) => {
    res.json({
        success: true,
        online: true,
        name: "MicBlox",
        players: players.size
    });
});

/* =========================
   JOIN
========================= */

app.post("/api/join", auth, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    const user =
        String(req.body.user || "unknown");

    const id = token();

    const player = {
        token: id,

        server: serverId,

        user,

        username: user,

        x: 0,
        y: 0,
        z: 0,

        micEnabled: false,
        muted: false,

        browserConnected: false,

        ws: null
    };

    players.set(id, player);

    if (!servers.has(serverId)) {
        servers.set(serverId, new Set());
    }

    servers.get(serverId).add(id);

    const base =
        `${req.protocol}://${req.get("host")}`;

    const url =
        `${base}/${id}`;

    console.log("[JOIN]", user);
    console.log("[LINK]", url);

    res.json({
        success: true,
        token: id,
        url
    });
});

/* =========================
   STATE
========================= */

app.get(
    "/api/state/:token",
    auth,
    (req, res) => {

        const player =
            getPlayer(req.params.token);

        if (!player) {
            return res.json({
                active: false,
                micEnabled: false,
                muted: false
            });
        }

        res.json({
            active: player.browserConnected,
            micEnabled: player.micEnabled,
            muted: player.muted
        });
    }
);

/* =========================
   POSITION
========================= */

app.post("/api/pos", auth, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    const spots =
        Array.isArray(req.body.spots)
            ? req.body.spots
            : [];

    for (const spot of spots) {

        if (!spot || !spot.t) {
            continue;
        }

        const player =
            getPlayer(spot.t);

        if (!player) {
            continue;
        }

        if (player.server !== serverId) {
            continue;
        }

        player.x = Number(spot.x) || 0;
        player.y = Number(spot.y) || 0;
        player.z = Number(spot.z) || 0;

        if (spot.name) {
            player.username =
                String(spot.name).slice(0, 40);
        }
    }

    broadcast(serverId, {
        type: "positions",

        players:
            getServerPlayers(serverId)
                .map(publicPlayer)
    });

    res.json({
        success: true
    });
});

/* =========================
   LEAVE
========================= */

app.post("/api/leave", auth, (req, res) => {

    const id =
        String(req.body.token || "");

    removePlayer(id);

    res.json({
        success: true
    });
});

function removePlayer(id) {

    const player =
        players.get(id);

    if (!player) return;

    if (player.ws) {
        try {
            player.ws.close();
        } catch {}
    }

    const set =
        servers.get(player.server);

    if (set) {

        set.delete(id);

        if (set.size === 0) {
            servers.delete(player.server);
        }
    }

    players.delete(id);

    broadcast(player.server, {
        type: "player_left",
        token: id
    });
}

/* =========================
   WEBSOCKET
========================= */

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    });

wss.on("connection", (ws, request) => {

    let parsed;

    try {
        parsed = new URL(
            request.url,
            `http://${request.headers.host}`
        );
    } catch {
        ws.close();
        return;
    }

    const id =
        parsed.searchParams.get("token");

    if (!id) {
        ws.close();
        return;
    }

    const player =
        getPlayer(id);

    if (!player) {
        ws.close();
        return;
    }

    if (player.ws) {
        try {
            player.ws.close();
        } catch {}
    }

    player.ws = ws;
    player.browserConnected = true;

    ws.send(JSON.stringify({
        type: "connected",

        token: player.token,

        player: publicPlayer(player)
    }));

    const peers =
        getServerPlayers(player.server)
            .filter(
                p =>
                    p.token !== player.token &&
                    p.browserConnected
            )
            .map(publicPlayer);

    ws.send(JSON.stringify({
        type: "peers",
        players: peers
    }));

    broadcast(player.server, {
        type: "player_joined",
        player: publicPlayer(player)
    });

    ws.on("message", raw => {

        let data;

        try {
            data =
                JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (data.type === "mic") {

            player.micEnabled =
                data.enabled === true;

            broadcast(player.server, {
                type: "player_update",
                player: publicPlayer(player)
            });

            return;
        }

        if (data.type === "username") {

            if (data.username) {
                player.username =
                    String(data.username)
                        .slice(0, 40);
            }

            broadcast(player.server, {
                type: "player_update",
                player: publicPlayer(player)
            });

            return;
        }

        if (data.type === "signal") {

            const target =
                getPlayer(data.to);

            if (!target) return;

            if (
                target.ws &&
                target.ws.readyState === WebSocket.OPEN
            ) {

                target.ws.send(
                    JSON.stringify({
                        type: "signal",
                        from: player.token,
                        signal: data.signal
                    })
                );
            }
        }
    });

    ws.on("close", () => {

        if (player.ws !== ws) {
            return;
        }

        player.ws = null;
        player.browserConnected = false;
        player.micEnabled = false;

        broadcast(player.server, {
            type: "player_update",
            player: publicPlayer(player)
        });
    });

    ws.on("error", () => {});
});

/* =========================
   PLAYER PAGE
========================= */

app.get("/:token", (req, res, next) => {

    const id =
        String(req.params.token);

    if (!players.has(id)) {
        return next();
    }

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

/* =========================
   START
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log("================================");
        console.log("        MICBLOX ONLINE");
        console.log("================================");
        console.log("PORT:", PORT);
        console.log("================================");
        console.log("");
    }
);
