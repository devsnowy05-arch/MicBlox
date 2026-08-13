const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
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

const MAX_DISTANCE = 30;
const FULL_DISTANCE = 5;

/*
============================================================
MIDDLEWARE
============================================================
*/

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"]
}));

app.use(express.json());

/*
============================================================
PUBLIC
============================================================
*/

const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

/*
============================================================
DATA
============================================================
*/

const players = new Map();
const servers = new Map();

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

    return players.get(String(token)) || null;
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

        browserConnected:
            player.browserConnected
    };
}


function broadcastToServer(serverId, message) {

    const encoded =
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
                player.ws.send(encoded);
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

    const indexPath =
        path.join(
            publicPath,
            "index.html"
        );

    res.sendFile(indexPath);
});

/*
============================================================
API STATUS
============================================================
*/

app.get("/api", (req, res) => {

    res.json({

        success: true,

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

app.post(
    "/api/join",
    checkApiKey,
    (req, res) => {

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

        /*
        --------------------------------------------------------
        CREATE TOKEN
        --------------------------------------------------------
        */

        const token =
            randomToken();

        /*
        --------------------------------------------------------
        CREATE PLAYER
        --------------------------------------------------------
        */

        const player = {

            token,

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

        players.set(
            token,
            player
        );

        /*
        --------------------------------------------------------
        SERVER LIST
        --------------------------------------------------------
        */

        if (!servers.has(serverId)) {

            servers.set(
                serverId,
                new Set()
            );
        }

        servers
            .get(serverId)
            .add(token);

        /*
        --------------------------------------------------------
        BUILD LINK
        --------------------------------------------------------
        */

        let baseUrl;

        /*
        Render / reverse proxy
        */

        if (
            process.env.RENDER_EXTERNAL_URL
        ) {

            baseUrl =
                process.env
                    .RENDER_EXTERNAL_URL
                    .replace(/\/$/, "");

        } else {

            const forwardedProto =
                req.headers["x-forwarded-proto"];

            const forwardedHost =
                req.headers["x-forwarded-host"];

            const protocol =
                forwardedProto
                    ? String(
                        forwardedProto
                    ).split(",")[0]
                    : req.protocol;

            const host =
                forwardedHost ||
                req.get("host");

            baseUrl =
                `${protocol}://${host}`;
        }

        const link =
            `${baseUrl}/${token}`;

        /*
        --------------------------------------------------------
        LOG
        --------------------------------------------------------
        */

        console.log("");
        console.log("==============================");
        console.log("NEW PLAYER");
        console.log("USER:", user);
        console.log("SERVER:", serverId);
        console.log("TOKEN:", token);
        console.log("LINK:", link);
        console.log("==============================");
        console.log("");

        /*
        --------------------------------------------------------
        RESPONSE
        --------------------------------------------------------
        */

        return res.status(200).json({

            success: true,

            token,

            url: link,

            link,

            maxDistance:
                MAX_DISTANCE,

            fullDistance:
                FULL_DISTANCE

        });
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

            return res.status(404).json({

                success: false,

                active: false,

                micEnabled: false,

                muted: false

            });
        }

        return res.json({

            success: true,

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

        /*
        --------------------------------------------------------
        UPDATE POSITIONS
        --------------------------------------------------------
        */

        for (const spot of spots) {

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

            if (spot.name) {

                player.username =
                    String(
                        spot.name
                    ).slice(0, 40);
            }
        }

        /*
        --------------------------------------------------------
        SEND POSITIONS
        --------------------------------------------------------
        */

        broadcastToServer(
            serverId,
            {

                type: "positions",

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

        return res.json({

            success: true,

            maxDistance:
                MAX_DISTANCE,

            fullDistance:
                FULL_DISTANCE

        });
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

                type: "player_update",

                player:
                    publicPlayer(player)

            }
        );

        return res.json({

            success: true,

            muted:
                player.muted

        });
    }
);

/*
============================================================
SPEAKER
============================================================
*/

app.post(
    "/api/speaker",
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

        return res.json({

            success: true

        });
    }
);

/*
============================================================
CHANNEL
============================================================
*/

app.post(
    "/api/chan",
    checkApiKey,
    (req, res) => {

        const serverId =
            String(
                req.body.server ||
                "unknown"
            );

        broadcastToServer(
            serverId,
            {

                type: "channel",

                action:
                    req.body.act || "",

                channel:
                    req.body.name || "",

                tokens:
                    Array.isArray(
                        req.body.tokens
                    )
                        ? req.body.tokens
                        : []

            }
        );

        return res.json({

            success: true

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

        return res.json({

            success: true

        });
    }
);

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

    /*
    Close websocket
    */

    if (
        player.ws &&
        player.ws.readyState ===
        WebSocket.OPEN
    ) {

        try {
            player.ws.close();
        } catch {}
    }

    /*
    Remove from server
    */

    const serverSet =
        servers.get(
            player.server
        );

    if (serverSet) {

        serverSet.delete(token);

        if (
            serverSet.size === 0
        ) {

            servers.delete(
                player.server
            );
        }
    }

    /*
    Remove player
    */

    players.delete(token);

    /*
    Notify others
    */

    broadcastToServer(
        player.server,
        {

            type: "player_left",

            token

        }
    );

    console.log(
        "[LEAVE]",
        player.user
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
        REPLACE OLD CONNECTION
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

        player.ws = ws;

        player.browserConnected =
            true;

        console.log(
            "[WS CONNECT]",
            player.user
        );

        /*
        --------------------------------------------------------
        CONNECTED
        --------------------------------------------------------
        */

        ws.send(
            JSON.stringify({

                type: "connected",

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

                type: "peers",

                players: peers

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
                        data.enabled === true;

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
                            ).slice(0, 40);
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
                    player.ws !== ws
                ) {

                    return;
                }

                player.ws = null;

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
                    player.user
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

        /*
        If token exists,
        show microphone page.
        */

        if (
            players.has(token)
        ) {

            return res.sendFile(
                path.join(
                    publicPath,
                    "index.html"
                )
            );
        }

        next();
    }
);

/*
============================================================
404
============================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error: "Not Found",

            path: req.path

        });
    }
);

/*
============================================================
ERROR HANDLER
============================================================
*/

app.use(
    (err, req, res, next) => {

        console.error(err);

        res.status(500).json({

            success: false,

            error: "Internal Server Error"

        });
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

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "       MicBlox ONLINE"
        );

        console.log(
            "================================"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "MAX DISTANCE:",
            MAX_DISTANCE,
            "meters"
        );

        console.log(
            "FULL DISTANCE:",
            FULL_DISTANCE,
            "meters"
        );

        console.log(
            "================================"
        );

        console.log("");
    }
);
