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

/*
TURN اختياري.
إذا عندك TURN server حطه في Environment Variables:

TURN_URL
TURN_USERNAME
TURN_CREDENTIAL

إذا ما عندك، النظام يستخدم Google STUN.
*/

const TURN_URL = process.env.TURN_URL || "";
const TURN_USERNAME = process.env.TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || "";

/*
============================================================
MIDDLEWARE
============================================================
*/

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "x-api-key"
        ]
    })
);

app.use(express.json());

/*
============================================================
PUBLIC
============================================================
*/

const PUBLIC_DIR =
    path.join(__dirname, "public");

app.use(
    express.static(PUBLIC_DIR)
);

/*
============================================================
DATA
============================================================
*/

const players = new Map();

const servers = new Map();

/*
Player:

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

    if (
        !key ||
        key !== API_KEY
    ) {

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
        .randomBytes(32)
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

    for (
        const player of
        players.values()
    ) {

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

                player.ws.send(
                    encoded
                );

            } catch {}
        }
    }
}

/*
============================================================
ICE CONFIG
============================================================
*/

function getIceServers() {

    const iceServers = [

        {
            urls:
                "stun:stun.l.google.com:19302"
        },

        {
            urls:
                "stun:stun1.l.google.com:19302"
        }

    ];

    if (
        TURN_URL &&
        TURN_USERNAME &&
        TURN_CREDENTIAL
    ) {

        iceServers.push({

            urls:
                TURN_URL,

            username:
                TURN_USERNAME,

            credential:
                TURN_CREDENTIAL

        });
    }

    return iceServers;
}

/*
============================================================
ROOT
============================================================
*/

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );
    }
);

/*
============================================================
API
============================================================
*/

app.get(
    "/api",
    (req, res) => {

        res.json({

            success:
                true,

            status:
                "online",

            name:
                "MicBlox",

            players:
                players.size,

            range:
                "unlimited"

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

        const serverId =
            String(
                req.body.server ||
                "unknown"
            );

        const user =
            String(
                req.body.user ||
                "Roblox Player"
            );

        const token =
            randomToken();

        const player = {

            token,

            server:
                serverId,

            user,

            username:
                user,

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

        /*
        --------------------------------------------------------
        URL
        --------------------------------------------------------
        */

        let protocol =
            req.headers[
                "x-forwarded-proto"
            ];

        let host =
            req.headers[
                "x-forwarded-host"
            ];

        if (
            protocol
        ) {

            protocol =
                String(protocol)
                    .split(",")[0]
                    .trim();

        } else {

            protocol =
                req.protocol;
        }

        if (
            !host
        ) {

            host =
                req.get("host");
        }

        /*
        Render external URL
        */

        let baseUrl;

        if (
            process.env.RENDER_EXTERNAL_URL
        ) {

            baseUrl =
                process.env
                    .RENDER_EXTERNAL_URL
                    .replace(
                        /\/$/,
                        ""
                    );

        } else {

            baseUrl =
                `${protocol}://${host}`;
        }

        const link =
            `${baseUrl}/${token}`;

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            "MICBLOX NEW PLAYER"
        );
        console.log(
            "USER:",
            user
        );
        console.log(
            "SERVER:",
            serverId
        );
        console.log(
            "LINK:",
            link
        );
        console.log(
            "================================"
        );
        console.log("");

        return res.json({

            success:
                true,

            token,

            url:
                link,

            link,

            iceServers:
                getIceServers()

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

            return res.status(404)
                .json({

                    success:
                        false,

                    active:
                        false,

                    micEnabled:
                        false,

                    muted:
                        false

                });
        }

        return res.json({

            success:
                true,

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

            if (
                spot.name
            ) {

                player.username =
                    String(
                        spot.name
                    ).slice(
                        0,
                        40
                    );
            }
        }

        /*
        مهم:
        لا يوجد distance هنا.
        كل اللاعبين يوصلون لبعض.
        */

        broadcastToServer(
            serverId,
            {

                type:
                    "positions",

                players:
                    getServerPlayers(
                        serverId
                    ).map(
                        publicPlayer
                    )

            }
        );

        return res.json({

            success:
                true

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

            return res.status(404)
                .json({

                    success:
                        false

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
                    publicPlayer(
                        player
                    )

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

            success:
                true

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

    if (
        player.ws &&
        player.ws.readyState ===
        WebSocket.OPEN
    ) {

        try {

            player.ws.close();

        } catch {}
    }

    const set =
        servers.get(
            player.server
        );

    if (set) {

        set.delete(token);

        if (
            set.size === 0
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
        OLD CONNECTION
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
            "[CONNECTED]",
            player.username
        );

        /*
        --------------------------------------------------------
        CONNECTED
        --------------------------------------------------------
        */

        ws.send(
            JSON.stringify({

                type:
                    "connected",

                token:
                    player.token,

                player:
                    publicPlayer(
                        player
                    ),

                iceServers:
                    getIceServers()

            })
        );

        /*
        --------------------------------------------------------
        EXISTING PLAYERS
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
        JOIN
        --------------------------------------------------------
        */

        broadcastToServer(
            player.server,
            {

                type:
                    "player_joined",

                player:
                    publicPlayer(
                        player
                    )

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
                    "[DISCONNECTED]",
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
            players.has(token)
        ) {

            return res.sendFile(
                path.join(
                    PUBLIC_DIR,
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

            success:
                false,

            error:
                "Not Found"

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
            "===================================="
        );
        console.log(
            "          MICBLOX ONLINE"
        );
        console.log(
            "===================================="
        );
        console.log(
            "PORT:",
            PORT
        );
        console.log(
            "VOICE RANGE: UNLIMITED"
        );
        console.log(
            "===================================="
        );
        console.log("");
    }
);
