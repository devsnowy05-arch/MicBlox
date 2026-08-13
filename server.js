const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

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

// الصوت كامل حتى هذا المدى
const FULL_DISTANCE = 7;

// رابط موقعك الثابت
const WEBSITE_URL = "https://micblox.onrender.com";

/*
============================================================
MIDDLEWARE
============================================================
*/

app.use(cors());

app.use(express.json());

/*
============================================================
STATIC
============================================================
*/

app.use(express.static(
    path.join(__dirname, "public")
));

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

    // إذا ما حطيت API_KEY في Render
    // يسمح بالطلب
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
    );
}

/*
============================================================
GET SERVER PLAYERS
============================================================
*/

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

app.get("/api", (req, res) => {

    res.json({

        status: "online",

        name: "MicBlox",

        players:
            players.size,

        maxDistance:
            MAX_DISTANCE,

        fullDistance:
            FULL_DISTANCE,

        website:
            WEBSITE_URL
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
        إنشاء Token
        */

        const token =
            randomToken();

        /*
        إنشاء اللاعب
        */

        const player = {

            token,

            server:
                serverId,

            user,

            username:
                "Roblox Player",

            x: 0,
            y: 0,
            z: 0,

            yaw: 0,

            micEnabled:
                false,

            muted:
                false,

            speaker:
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

        /*
        إضافة للسيرفر
        */

        if (
            !servers.has(
                serverId
            )
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
        الرابط
        */

        const url =
            WEBSITE_URL +
            "/" +
            token;

        console.log(
            "[JOIN]",
            user,
            "TOKEN:",
            token
        );

        console.log(
            "[JOIN] URL:",
            url
        );

        /*
        إرسال النتيجة إلى Roblox
        */

        return res.json({

            success:
                true,

            token,

            url,

            website:
                WEBSITE_URL
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

            return res.json({

                active:
                    false,

                exists:
                    false
            });
        }

        res.json({

            active:
                player.browserConnected,

            exists:
                true,

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
        تحديث المواقع
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

            player.yaw =
                Number(spot.yaw) || 0;
        }

        /*
        إرسال المواقع
        */

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

            return res.status(404)
                .json({
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
                req.body.token || ""
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

    players.delete(
        token
    );

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

        let url;

        try {

            url =
                new URL(
                    request.url,
                    "http://" +
                    request.headers.host
                );

        } catch {

            ws.close();

            return;
        }

        const token =
            url.searchParams.get(
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
        اتصال الموقع
        */

        player.ws =
            ws;

        player.browserConnected =
            true;

        console.log(
            "[WS CONNECT]",
            player.user,
            player.token
        );

        /*
        بيانات اللاعب
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
                    )
            })
        );

        /*
        اللاعبين الموجودين
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
        إعلام الآخرين
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
        الرسائل
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

                    if (
                        !target ||
                        !target.ws
                    ) {

                        return;
                    }

                    if (
                        target.ws.readyState ===
                        WebSocket.OPEN
                    ) {

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
                    }

                    return;
                }
            }
        );

        /*
        DISCONNECT
        */

        ws.on(
            "close",
            () => {

                if (
                    player.ws ===
                    ws
                ) {

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
                        player.user
                    );
                }
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
        إذا التوكن غير موجود
        */

        if (
            !players.has(token)
        ) {

            return next();
        }

        /*
        افتح الموقع
        */

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
404
============================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

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
    () => {

        console.log(
            "================================"
        );

        console.log(
            "MicBlox Server Started"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "WEBSITE:",
            WEBSITE_URL
        );

        console.log(
            "MAX DISTANCE:",
            MAX_DISTANCE
        );

        console.log(
            "FULL DISTANCE:",
            FULL_DISTANCE
        );

        console.log(
            "================================"
        );
    }
);
