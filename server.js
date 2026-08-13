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

// أقصى مدى للصوت
const MAX_DISTANCE = 30;

// عند 7 متر أو أقل = صوت كامل
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
WEBSITE
============================================================
*/

app.use(express.static(path.join(__dirname, "public")));

/*
============================================================
DATA
============================================================
*/

const players = new Map();
const servers = new Map();

/*
PLAYER:

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

    // إذا ما حطيت API_KEY في Render
    // يسمح للطلب
    if (!API_KEY) {
        return next();
    }

    const key =
        req.headers["x-api-key"];

    if (!key || key !== API_KEY) {

        return res.status(401).json({
            error: "unauthorized"
        });
    }

    next();
}

/*
============================================================
TOKEN
============================================================
*/

function randomToken() {

    return crypto
        .randomBytes(18)
        .toString("hex");
}

/*
============================================================
GET PLAYER
============================================================
*/

function getPlayer(token) {

    if (!token) {
        return null;
    }

    return players.get(
        String(token)
    ) || null;
}

/*
============================================================
GET SERVER PLAYERS
============================================================
*/

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

/*
============================================================
PUBLIC PLAYER
============================================================
*/

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

        yaw:
            player.yaw,

        micEnabled:
            player.micEnabled,

        muted:
            player.muted,

        speaker:
            player.speaker,

        browserConnected:
            player.browserConnected
    };
}

/*
============================================================
BROADCAST
============================================================
*/

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
API STATUS
============================================================
*/

app.get(
    "/api",
    (req, res) => {

        res.json({

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
        Create token
        */

        const token =
            randomToken();

        /*
        Player
        */

        const player = {

            token,

            server:
                serverId,

            user,

            username:
                "Roblox Player",

            /*
            Roblox position
            */

            x: 0,
            y: 0,
            z: 0,

            yaw: 0,

            /*
            Voice
            */

            micEnabled:
                false,

            muted:
                false,

            speaker:
                false,

            /*
            Browser
            */

            browserConnected:
                false,

            ws:
                null
        };

        players.set(
            token,
            player
        );

        /*
        Server list
        */

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
        URL
        */

        const protocol =
            req.headers["x-forwarded-proto"] ||
            req.protocol ||
            "https";

        const host =
            req.get("host");

        const baseUrl =
            `${protocol}://${host}`;

        const playerUrl =
            `${baseUrl}/${token}`;

        console.log(
            "[JOIN]",
            user,
            "server:",
            serverId
        );

        res.json({

            token,

            url:
                playerUrl,

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
                active: false
            });
        }

        res.json({

            active:
                player.browserConnected,

            micEnabled:
                player.micEnabled,

            muted:
                player.muted,

            maxDistance:
                MAX_DISTANCE,

            fullDistance:
                FULL_DISTANCE
        });
    }
);

/*
============================================================
POSITION UPDATE
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
        IMPORTANT:

        We force the voice distance
        to 30 meters.

        Roblox can send another value,
        but server uses 30.
        */

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

            /*
            Don't allow another
            Roblox server to update
            this player.
            */

            if (
                player.server !==
                serverId
            ) {
                continue;
            }

            /*
            Position
            */

            player.x =
                Number.isFinite(
                    Number(spot.x)
                )
                    ? Number(spot.x)
                    : 0;

            player.y =
                Number.isFinite(
                    Number(spot.y)
                )
                    ? Number(spot.y)
                    : 0;

            player.z =
                Number.isFinite(
                    Number(spot.z)
                )
                    ? Number(spot.z)
                    : 0;

            player.yaw =
                Number.isFinite(
                    Number(spot.yaw)
                )
                    ? Number(spot.yaw)
                    : 0;
        }

        /*
        Send positions to browsers
        */

        broadcastToServer(
            serverId,
            {

                type:
                    "positions",

                /*
                FORCE 30 METERS
                */

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

            success:
                true,

            maxDistance:
                MAX_DISTANCE
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

                success:
                    false
            });
        }

        player.speaker =
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

            speaker:
                player.speaker
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

        const action =
            String(
                req.body.act || ""
            );

        const channel =
            String(
                req.body.name || ""
            );

        const tokenList =
            Array.isArray(
                req.body.tokens
            )
                ? req.body.tokens
                : [];

        const serverId =
            String(
                req.body.server ||
                "unknown"
            );

        broadcastToServer(
            serverId,
            {

                type:
                    "channel",

                action,

                channel,

                tokens:
                    tokenList
            }
        );

        res.json({

            success:
                true
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

        if (!token) {

            return res.json({
                success: true
            });
        }

        removePlayer(
            token
        );

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

function removePlayer(
    token
) {

    const player =
        players.get(
            token
        );

    if (!player) {
        return;
    }

    /*
    Close websocket
    */

    if (
        player.ws &&
        (
            player.ws.readyState ===
            WebSocket.OPEN ||
            player.ws.readyState ===
            WebSocket.CONNECTING
        )
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

    /*
    Remove player
    */

    players.delete(
        token
    );

    /*
    Tell browsers
    */

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

        path:
            "/ws"
    });

wss.on(
    "connection",
    (ws, request) => {

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

        /*
        Token
        */

        const token =
            url.searchParams.get(
                "token"
            );

        if (!token) {

            ws.close();

            return;
        }

        /*
        Player
        */

        const player =
            getPlayer(
                token
            );

        if (!player) {

            ws.close();

            return;
        }

        /*
        If old browser exists
        */

        if (
            player.ws &&
            player.ws !== ws
        ) {

            try {
                player.ws.close();
            } catch {}
        }

        /*
        Browser connected
        */

        player.ws =
            ws;

        player.browserConnected =
            true;

        /*
        Reset mic
        */

        player.micEnabled =
            false;

        /*
        Connected
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

                maxDistance:
                    MAX_DISTANCE,

                fullDistance:
                    FULL_DISTANCE
            })
        );

        /*
        Existing peers
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
        Tell everyone
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
        ========================================================
        WEBSOCKET MESSAGE
        ========================================================
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
                ------------------------------------------------
                MIC
                ------------------------------------------------
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
                ------------------------------------------------
                USERNAME
                ------------------------------------------------
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
                ------------------------------------------------
                WEBRTC SIGNAL
                ------------------------------------------------
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

                    /*
                    Only allow signaling
                    inside same Roblox server
                    */

                    if (
                        target.server !==
                        player.server
                    ) {
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
        ========================================================
        CLOSE
        ========================================================
        */

        ws.on(
            "close",
            () => {

                /*
                Make sure this is
                still the current socket
                */

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
TOKEN WEBSITE ROUTE
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
        Don't treat API paths
        as player tokens
        */

        if (
            token === "api" ||
            token === "ws"
        ) {

            return next();
        }

        /*
        Token must exist
        */

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
CLEANUP OLD PLAYERS
============================================================
*/

/*
Remove players that somehow
stay alive without browser
for a long time.

Roblox /leave normally removes them.
*/

setInterval(
    () => {

        const now =
            Date.now();

        /*
        This system intentionally
        does not delete players simply
        because browser is disconnected,
        because Roblox may reconnect.
        */

        for (
            const player of
            players.values()
        ) {

            if (
                !player.browserConnected &&
                player.ws === null
            ) {

                // Nothing to do.
                // Roblox /leave handles removal.
            }
        }

    },
    60000
);

/*
============================================================
START
============================================================
*/

server.listen(
    PORT,
    () => {

        console.log(
            "=========================================="
        );

        console.log(
            "MicBlox Server Started"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Max Voice Distance:",
            MAX_DISTANCE,
            "meters"
        );

        console.log(
            "Full Voice Distance:",
            FULL_DISTANCE,
            "meters"
        );

        console.log(
            "=========================================="
        );
    }
);
