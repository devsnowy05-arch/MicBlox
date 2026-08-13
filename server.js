const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

/*
============================================================
CONFIG
============================================================
*/

const API_KEY = process.env.API_KEY || "";

const MAX_DISTANCE = 55;
const FULL_DISTANCE = 7;

/*
============================================================
MIDDLEWARE
============================================================
*/

app.use(cors());
app.use(express.json());

/*
============================================================
STATIC WEBSITE
============================================================
*/

app.use(express.static("public"));

/*
============================================================
DATA
============================================================
*/

const players = new Map();
const servers = new Map();

/*
player structure:

{
    token,
    server,
    user,
    username,

    x,
    y,
    z,
    yaw,

    micEnabled,
    muted,
    speaker,

    browserConnected,
    ws
}
*/

/*
============================================================
AUTH
============================================================
*/

function checkApiKey(req, res, next) {
    if (!API_KEY) {
        return next();
    }

    const key = req.headers["x-api-key"];

    if (!key || key !== API_KEY) {
        return res.status(401).json({
            error: "unauthorized"
        });
    }

    next();
}

/*
============================================================
HELPERS
============================================================
*/

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
        speaker: player.speaker
    };
}

function broadcastToServer(serverId, message) {
    const encoded = JSON.stringify(message);

    for (const player of getServerPlayers(serverId)) {
        if (
            player.ws &&
            player.ws.readyState === WebSocket.OPEN
        ) {
            player.ws.send(encoded);
        }
    }
}

/*
============================================================
ROOT / API STATUS
============================================================
*/

app.get("/api", (req, res) => {
    res.json({
        status: "online",
        name: "MicBlox",
        players: players.size
    });
});

/*
============================================================
JOIN
============================================================
*/

app.post("/api/join", checkApiKey, (req, res) => {

    const serverId = String(req.body.server || "unknown");
    const user = String(req.body.user || "unknown");

    const token = randomToken();

    const player = {
        token,
        server: serverId,
        user,

        username: "Player",

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

    const baseUrl =
        `${req.protocol}://${req.get("host")}`;

    res.json({
        token,
        url: `${baseUrl}/${token}`
    });
});

/*
============================================================
STATE
============================================================
*/

app.get("/api/state/:token", checkApiKey, (req, res) => {

    const player =
        getPlayer(req.params.token);

    if (!player) {
        return res.status(404).json({
            active: false
        });
    }

    res.json({
        active: player.browserConnected,
        micEnabled: player.micEnabled,
        muted: player.muted
    });
});

/*
============================================================
POSITION
============================================================
*/

app.post("/api/pos", checkApiKey, (req, res) => {

    const serverId =
        String(req.body.server || "unknown");

    const spots =
        Array.isArray(req.body.spots)
            ? req.body.spots
            : [];

    const hear =
        req.body.hear || {};

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
        player.yaw = Number(spot.yaw) || 0;

        if (spot.name) {
            player.username =
                String(spot.name);
        }
    }

    const max =
        Number(hear.max) || MAX_DISTANCE;

    const full =
        Number(hear.full) || FULL_DISTANCE;

    broadcastToServer(
        serverId,
        {
            type: "positions",

            maxDistance: max,
            fullDistance: full,

            players:
                getServerPlayers(serverId)
                    .map(publicPlayer)
        }
    );

    res.json({
        success: true
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
        success: true,
        muted: player.muted
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
        success: true,
        speaker: player.speaker
    });
});

/*
============================================================
CHANNEL
============================================================
*/

app.post("/api/chan", checkApiKey, (req, res) => {

    const action =
        String(req.body.act || "");

    const channel =
        String(req.body.name || "");

    const tokenList =
        Array.isArray(req.body.tokens)
            ? req.body.tokens
            : [];

    const serverId =
        String(req.body.server || "unknown");

    broadcastToServer(
        serverId,
        {
            type: "channel",
            action,
            channel,
            tokens: tokenList
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

    const token =
        String(req.body.token || "");

    const player =
        getPlayer(token);

    if (!player) {
        return res.json({
            success: true
        });
    }

    removePlayer(token);

    res.json({
        success: true
    });
});

/*
============================================================
REMOVE PLAYER
============================================================
*/

function removePlayer(token) {

    const player =
        players.get(token);

    if (!player) {
        return;
    }

    if (
        player.ws &&
        player.ws.readyState === WebSocket.OPEN
    ) {
        try {
            player.ws.close();
        } catch {}
    }

    const serverSet =
        servers.get(player.server);

    if (serverSet) {

        serverSet.delete(token);

        if (serverSet.size === 0) {
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
        url =
            new URL(
                request.url,
                `http://${request.headers.host}`
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

    /*
    Browser connected
    */

    player.ws = ws;
    player.browserConnected = true;

    /*
    Send current player data
    */

    ws.send(JSON.stringify({
        type: "connected",

        token: player.token,

        player: publicPlayer(player)
    }));

    /*
    Send existing peers
    */

    const peers =
        getServerPlayers(player.server)
            .filter(
                other =>
                    other.token !== player.token &&
                    other.browserConnected
            )
            .map(publicPlayer);

    ws.send(JSON.stringify({
        type: "peers",
        players: peers
    }));

    /*
    Tell other players
    */

    broadcastToServer(
        player.server,
        {
            type: "player_joined",
            player: publicPlayer(player)
        }
    );

    /*
    Messages
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
        --------------------------------------------------------
        MIC
        --------------------------------------------------------
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
        --------------------------------------------------------
        USERNAME
        --------------------------------------------------------
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
        --------------------------------------------------------
        WEBRTC SIGNAL
        --------------------------------------------------------
        */

        if (data.type === "signal") {

            const target =
                getPlayer(data.to);

            if (!target) {
                return;
            }

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

            return;
        }
    });

    /*
    Browser disconnected
    */

    ws.on("close", () => {

        if (player.ws === ws) {

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
        }
    });

    ws.on("error", () => {});
});

/*
============================================================
TOKEN WEBSITE ROUTE
============================================================
*/

app.get("/:token", (req, res, next) => {

    const token =
        String(req.params.token);

    if (!players.has(token)) {
        return next();
    }

    res.sendFile(
        require("path").join(
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
        `MicBlox running on port ${PORT}`
    );

});
