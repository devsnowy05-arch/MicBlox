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

/*
============================================================
CONFIG
============================================================
*/

// المدى مؤقتًا معطل.
// لاحقًا نخليه 30 متر بعد التأكد من الصوت.
const MAX_DISTANCE = 999999;
const FULL_DISTANCE = 5;

/*
============================================================
MIDDLEWARE
============================================================
*/

app.use(cors());

app.use(express.json({
    limit: "1mb"
}));

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

/*
============================================================
DATA
============================================================
*/

const players = new Map();
const servers = new Map();

/*
player:

{
    token,
    server,
    user,
    username,

    x,
    y,
    z,

    micEnabled,
    muted,

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

    const key =
        req.headers["x-api-key"];

    if (!key || key !== API_KEY) {

        return res.status(401).json({
            success: false,
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

    return crypto
        .randomBytes(24)
        .toString("hex");
}

function getPlayer(token) {

    if (!token) {
        return null;
    }

    return players.get(
        String(token)
    ) || null;
}

function getServerPlayers(serverId) {

    const result = [];

    for (const player of players.values()) {

        if (
            player.server ===
            serverId
        ) {
            result.push(player);
        }
    }

    return result;
}

function publicPlayer(player) {

    return {

        token:
            player.token,

        user:
            player.user,

        username:
            player.username,

        x:
            player.x,

        y:
            player.y,

        z:
            player.z,

        micEnabled:
            player.micEnabled,

        muted:
            player.muted,

        browserConnected:
            player.browserConnected
    };
}

function broadcastToServer(
    serverId,
    message
) {

    const data =
        JSON.stringify(message);

    for (
        const player of
        getServerPlayers(serverId)
    ) {

        if (
            player.ws &&
            player.ws.readyState ===
            WebSocket.OPEN
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
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

/*
============================================================
STATUS
============================================================
*/

app.get(
    "/api",
    (req, res) => {

        res.json({

            success: true,

            status:
                "online",

            name:
                "MicBlox",

            players:
                players.size,

            maxDistance:
                MAX_DISTANCE,

            fullDistance:
                FULL_DISTANCE
        });
    }
);

/*
============================================================
JOIN
============================================================
*/

app.post(
    "/api/join",
    checkApiKey,
    (req, res) => {

        try {

            const serverId =
                String(
                    req.body.server ||
                    "unknown"
                );

            const user =
                String(
                    req.body.user ||
                    "unknown"
                );

            const username =
                String(
                    req.body.username ||
                    "Roblox Player"
                );

            const token =
                randomToken();

            const player = {

                token,

                server:
                    serverId,

                user,

                username,

                x: 0,
                y: 0,
                z: 0,

                micEnabled:
                    false,

                muted:
                    false,

                browserConnected:
                    false,

                ws:
                    null
            };

            players.set(
                token,
                player
            );

            if (
                !servers.has(serverId)
            ) {

                servers.set(
                    serverId,
                    new Set()
                );
            }

            servers
                .get(serverId)
                .add(token);

            const baseUrl =
                `${req.protocol}://${req.get("host")}`;

            const link =
                `${baseUrl}/${token}`;

            console.log(
                "[JOIN]",
                username,
                link
            );

            return res.json({

                success:
                    true,

                token,

                url:
                    link
            });

        } catch (error) {

            console.error(
                "[JOIN ERROR]",
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "join_failed"
            });
        }
    }
);

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
            getPlayer(
                req.params.token
            );

        if (!player) {

            return res.json({

                active:
                    false,

                micEnabled:
                    false,

                muted:
                    false
            });
        }

        res.json({

            active:
                player.browserConnected,

            micEnabled:
                player.micEnabled,

            muted:
                player.muted
        });
    }
);

/*
============================================================
POSITION
============================================================
*/

app.post(
    "/api/pos",
    checkApiKey,
    (req, res) => {

        try {

            const serverId =
                String(
                    req.body.server ||
                    "unknown"
                );

            const spots =
                Array.isArray(
                    req.body.spots
                )
                    ? req.body.spots
                    : [];

            for (
                const spot of spots
            ) {

                if (
                    !spot ||
                    !spot.t
                ) {
                    continue;
                }

                const player =
                    getPlayer(
                        spot.t
                    );

                if (!player) {
                    continue;
                }

                if (
                    player.server !==
                    serverId
                ) {
                    continue;
                }

                player.x =
                    Number(spot.x) || 0;

                player.y =
                    Number(spot.y) || 0;

                player.z =
                    Number(spot.z) || 0;
            }

            broadcastToServer(
                serverId,
                {

                    type:
                        "positions",

                    maxDistance:
                        MAX_DISTANCE,

                    fullDistance:
                        FULL_DISTANCE,

                    players:
                        getServerPlayers(
                            serverId
                        ).map(
                            publicPlayer
                        )
                }
            );

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "[POSITION ERROR]",
                error
            );

            res.status(500).json({
                success: false
            });
        }
    }
);

/*
============================================================
MUTE
============================================================
*/

app.post(
    "/api/mute",
    checkApiKey,
    (req, res) => {

        const player =
            getPlayer(
                req.body.token
            );

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

                type:
                    "player_update",

                player:
                    publicPlayer(player)
            }
        );

        res.json({

            success:
                true,

            muted:
                player.muted
        });
    }
);

/*
============================================================
LEAVE
============================================================
*/

app.post(
    "/api/leave",
    checkApiKey,
    (req, res) => {

        const token =
            String(
                req.body.token ||
                ""
            );

        removePlayer(token);

        res.json({
            success: true
        });
    }
);

/*
============================================================
REMOVE
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
        player.ws.readyState ===
        WebSocket.OPEN
    ) {

        try {
            player.ws.close();
        } catch {}
    }

    const serverSet =
        servers.get(
            player.server
        );

    if (serverSet) {

        serverSet.delete(
            token
        );

        if (
            serverSet.size === 0
        ) {

            servers.delete(
                player.server
            );
        }
    }

    players.delete(token);

    broadcastToServer(
        player.server,
        {

            type:
                "player_left",

            token
        }
    );

    console.log(
        "[LEAVE]",
        token
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

        path:
            "/ws"
    });

wss.on(
    "connection",
    (ws, request) => {

        let parsed;

        try {

            parsed =
                new URL(
                    request.url,
                    `http://${request.headers.host}`
                );

        } catch {

            ws.close();

            return;
        }

        const token =
            parsed.searchParams.get(
                "token"
            );

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
        --------------------------------------------------------
        CONNECT
        --------------------------------------------------------
        */

        if (
            player.ws &&
            player.ws !== ws
        ) {

            try {
                player.ws.close();
            } catch {}
        }

        player.ws =
            ws;

        player.browserConnected =
            true;

        console.log(
            "[WS CONNECT]",
            player.username
        );

        /*
        --------------------------------------------------------
        SELF
        --------------------------------------------------------
        */

        ws.send(
            JSON.stringify({

                type:
                    "connected",

                token:
                    player.token,

                player:
                    publicPlayer(player),

                maxDistance:
                    MAX_DISTANCE,

                fullDistance:
                    FULL_DISTANCE
            })
        );

        /*
        --------------------------------------------------------
        PEERS
        --------------------------------------------------------
        */

        const peers =
            getServerPlayers(
                player.server
            )
            .filter(
                other =>
                    other.token !==
                    player.token &&
                    other.browserConnected
            )
            .map(
                publicPlayer
            );

        ws.send(
            JSON.stringify({

                type:
                    "peers",

                players:
                    peers
            })
        );

        /*
        --------------------------------------------------------
        JOIN BROADCAST
        --------------------------------------------------------
        */

        broadcastToServer(
            player.server,
            {

                type:
                    "player_joined",

                player:
                    publicPlayer(player)
            }
        );

        /*
        --------------------------------------------------------
        MESSAGE
        --------------------------------------------------------
        */

        ws.on(
            "message",
            raw => {

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

                if (
                    data.type ===
                    "mic"
                ) {

                    player.micEnabled =
                        data.enabled ===
                        true;

                    broadcastToServer(
                        player.server,
                        {

                            type:
                                "player_update",

                            player:
                                publicPlayer(
                                    player
                                )
                        }
                    );

                    return;
                }

                /*
                USERNAME
                */

                if (
                    data.type ===
                    "username"
                ) {

                    if (
                        data.username
                    ) {

                        player.username =
                            String(
                                data.username
                            ).slice(
                                0,
                                40
                            );
                    }

                    broadcastToServer(
                        player.server,
                        {

                            type:
                                "player_update",

                            player:
                                publicPlayer(
                                    player
                                )
                        }
                    );

                    return;
                }

                /*
                WEBRTC SIGNAL
                */

                if (
                    data.type ===
                    "signal"
                ) {

                    const target =
                        getPlayer(
                            data.to
                        );

                    if (!target) {
                        return;
                    }

                    if (
                        target.ws &&
                        target.ws.readyState ===
                        WebSocket.OPEN
                    ) {

                        try {

                            target.ws.send(
                                JSON.stringify({

                                    type:
                                        "signal",

                                    from:
                                        player.token,

                                    signal:
                                        data.signal
                                })
                            );

                        } catch {}
                    }

                    return;
                }
            }
        );

        /*
        --------------------------------------------------------
        CLOSE
        --------------------------------------------------------
        */

        ws.on(
            "close",
            () => {

                if (
                    player.ws !==
                    ws
                ) {
                    return;
                }

                player.ws =
                    null;

                player.browserConnected =
                    false;

                player.micEnabled =
                    false;

                broadcastToServer(
                    player.server,
                    {

                        type:
                            "player_update",

                        player:
                            publicPlayer(
                                player
                            )
                    }
                );

                console.log(
                    "[WS DISCONNECT]",
                    player.username
                );
            }
        );

        ws.on(
            "error",
            () => {}
        );
    }
);

/*
============================================================
TOKEN PAGE
============================================================
*/

app.get(
    "/:token",
    (req, res, next) => {

        const token =
            String(
                req.params.token
            );

        if (
            !players.has(token)
        ) {

            return next();
        }

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );
    }
);

/*
============================================================
START
============================================================
*/

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "MicBlox ONLINE"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "VOICE MODE: ACTIVE"
        );

        console.log(
            "DISTANCE MODE: TEMPORARILY OFF"
        );

        console.log(
            "================================"
        );
    }
);
