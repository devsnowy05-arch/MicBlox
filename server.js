const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";

const WEBSITE_URL = "https://micblox.onrender.com";

const MAX_DISTANCE = 30;
const FULL_DISTANCE = 7;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const players = new Map();
const servers = new Map();

function checkApiKey(req, res, next) {
    if (!API_KEY) return next();

    const key = req.headers["x-api-key"];

    if (key !== API_KEY) {
        return res.status(401).json({
            error: "unauthorized"
        });
    }

    next();
}

function randomToken() {
    return crypto.randomBytes(18).toString("hex");
}

function getPlayer(token) {
    return players.get(String(token));
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
        yaw: player.yaw,

        micEnabled: player.micEnabled,
        muted: player.muted,
        speaker: player.speaker,

        browserConnected: player.browserConnected
    };
}

function broadcastToServer(serverId, message) {
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

/*
============================================================
ROOT
============================================================
*/

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

app.get("/api", (req, res) => {
    res.json({
        status: "online",
        name: "MicBlox",
        players: players.size,
        maxDistance: MAX_DISTANCE,
        fullDistance: FULL_DISTANCE
    });
});

/*
============================================================
JOIN
============================================================
*/

app.post("/api/join", checkApiKey, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    const user =
        String(req.body.user || "unknown");

    const token = randomToken();

    const player = {
        token,
        server: serverId,
        user,

        username: user,

        x: 0,
        y: 0,
        z: 0,
        yaw: 0,

        micEnabled: false,
        muted: false,
        speaker: false,

        browserConnected: false,
        ws: null
    };

    players.set(token, player);

    if (!servers.has(serverId)) {
        servers.set(serverId, new Set());
    }

    servers.get(serverId).add(token);

    const url =
        WEBSITE_URL + "/" + token;

    console.log("[JOIN]", user);
    console.log("[URL]", url);

    res.json({
        success: true,
        token,
        url
    });
});

/*
============================================================
STATE
============================================================
*/

app.get(
    "/api/state/:token",
    checkApiKey,
    (req, res) => {

        const player =
            getPlayer(req.params.token);

        if (!player) {
            return res.json({
                active: false
            });
        }

        res.json({
            active: player.browserConnected,
            micEnabled: player.micEnabled,
            muted: player.muted
        });
    }
);

/*
============================================================
POSITIONS
============================================================
*/

app.post("/api/pos", checkApiKey, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    const spots =
        Array.isArray(req.body.spots)
            ? req.body.spots
            : [];

    for (const spot of spots) {

        if (!spot || !spot.t) continue;

        const player =
            getPlayer(spot.t);

        if (!player) continue;

        if (player.server !== serverId) {
            continue;
        }

        player.x = Number(spot.x) || 0;
        player.y = Number(spot.y) || 0;
        player.z = Number(spot.z) || 0;
        player.yaw = Number(spot.yaw) || 0;
    }

    broadcastToServer(
        serverId,
        {
            type: "positions",

            maxDistance: MAX_DISTANCE,
            fullDistance: FULL_DISTANCE,

            players:
                getServerPlayers(serverId)
                    .map(publicPlayer)
        }
    );

    res.json({
        success: true,
        maxDistance: MAX_DISTANCE
    });
});

/*
============================================================
MUTE
============================================================
*/

app.post("/api/mute", checkApiKey, (req, res) => {

    const player =
        getPlayer(req.body.token);

    if (!player) {
        return res.status(404).json({
            success: false
        });
    }

    player.muted =
        req.body.on === true;

    broadcastToServer(
        player.server,
        {
            type: "player_update",
            player: publicPlayer(player)
        }
    );

    res.json({
        success: true
    });
});

/*
============================================================
SPEAKER
============================================================
*/

app.post("/api/speaker", checkApiKey, (req, res) => {

    const player =
        getPlayer(req.body.token);

    if (!player) {
        return res.status(404).json({
            success: false
        });
    }

    player.speaker =
        req.body.on === true;

    broadcastToServer(
        player.server,
        {
            type: "player_update",
            player: publicPlayer(player)
        }
    );

    res.json({
        success: true
    });
});

/*
============================================================
CHANNEL
============================================================
*/

app.post("/api/chan", checkApiKey, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    broadcastToServer(
        serverId,
        {
            type: "channel",

            action:
                String(req.body.act || ""),

            channel:
                String(req.body.name || ""),

            tokens:
                Array.isArray(req.body.tokens)
                    ? req.body.tokens
                    : []
        }
    );

    res.json({
        success: true
    });
});

/*
============================================================
LEAVE
============================================================
*/

app.post("/api/leave", checkApiKey, (req, res) => {

    removePlayer(
        String(req.body.token || "")
    );

    res.json({
        success: true
    });
});

function removePlayer(token) {

    const player =
        players.get(token);

    if (!player) return;

    if (player.ws) {
        try {
            player.ws.close();
        } catch {}
    }

    const set =
        servers.get(player.server);

    if (set) {
        set.delete(token);

        if (set.size === 0) {
            servers.delete(player.server);
        }
    }

    players.delete(token);

    broadcastToServer(
        player.server,
        {
            type: "player_left",
            token
        }
    );
}

/*
============================================================
WEBSOCKET
============================================================
*/

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    });

wss.on("connection", (ws, request) => {

    let url;

    try {
        url = new URL(
            request.url,
            "http://" +
            request.headers.host
        );
    } catch {
        ws.close();
        return;
    }

    const token =
        url.searchParams.get("token");

    if (!token) {
        ws.close();
        return;
    }

    const player =
        getPlayer(token);

    if (!player) {
        ws.close();
        return;
    }

    player.ws = ws;
    player.browserConnected = true;

    console.log(
        "[WS CONNECT]",
        player.username
    );

    /*
    اللاعب نفسه
    */

    ws.send(JSON.stringify({
        type: "connected",
        token: player.token,
        player: publicPlayer(player)
    }));

    /*
    اللاعبين الموجودين
    */

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

    /*
    أبلغ الآخرين
    */

    broadcastToServer(
        player.server,
        {
            type: "player_joined",
            player: publicPlayer(player)
        }
    );

    /*
    الرسائل
    */

    ws.on("message", raw => {

        let data;

        try {
            data =
                JSON.parse(
                    raw.toString()
                );
        } catch {
            return;
        }

        /*
        MIC
        */

        if (data.type === "mic") {

            player.micEnabled =
                data.enabled === true;

            broadcastToServer(
                player.server,
                {
                    type: "player_update",
                    player: publicPlayer(player)
                }
            );

            return;
        }

        /*
        USERNAME
        */

        if (data.type === "username") {

            if (data.username) {
                player.username =
                    String(data.username)
                        .slice(0, 40);
            }

            broadcastToServer(
                player.server,
                {
                    type: "player_update",
                    player: publicPlayer(player)
                }
            );

            return;
        }

        /*
        WEBRTC SIGNAL
        */

        if (data.type === "signal") {

            const target =
                getPlayer(data.to);

            if (!target || !target.ws) {
                return;
            }

            if (
                target.ws.readyState ===
                WebSocket.OPEN
            ) {

                target.ws.send(
                    JSON.stringify({
                        type: "signal",

                        from:
                            player.token,

                        signal:
                            data.signal
                    })
                );
            }

            return;
        }
    });

    ws.on("close", () => {

        if (player.ws !== ws) {
            return;
        }

        player.ws = null;
        player.browserConnected = false;
        player.micEnabled = false;

        broadcastToServer(
            player.server,
            {
                type: "player_update",
                player: publicPlayer(player)
            }
        );

        console.log(
            "[WS DISCONNECT]",
            player.username
        );
    });

    ws.on("error", () => {});
});

/*
============================================================
TOKEN PAGE
============================================================
*/

app.get("/:token", (req, res, next) => {

    const token =
        String(req.params.token);

    if (!players.has(token)) {
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

/*
============================================================
START
============================================================
*/

server.listen(PORT, () => {

    console.log(
        "================================="
    );

    console.log(
        "MicBlox Online"
    );

    console.log(
        "Port:",
        PORT
    );

    console.log(
        "Max Distance:",
        MAX_DISTANCE
    );

    console.log(
        "================================="
    );
});
