const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ server });

const players = new Map();

app.get("/", (req, res) => {
    res.json({
        status: "online",
        name: "MicBlox",
        players: players.size
    });
});

app.get("/players", (req, res) => {
    const result = [];

    for (const [id, player] of players) {
        result.push({
            id,
            username: player.username,
            x: player.x,
            y: player.y,
            z: player.z,
            micEnabled: player.micEnabled
        });
    }

    res.json(result);
});

wss.on("connection", (ws) => {
    const playerId = crypto.randomUUID();

    players.set(playerId, {
        username: "Unknown",
        x: 0,
        y: 0,
        z: 0,
        micEnabled: false,
        ws
    });

    ws.send(JSON.stringify({
        type: "connected",
        id: playerId
    }));

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message.toString());
            const player = players.get(playerId);

            if (!player) return;

            if (data.type === "player_update") {
                player.username = data.username || player.username;

                player.x = Number(data.x) || 0;
                player.y = Number(data.y) || 0;
                player.z = Number(data.z) || 0;

                if (typeof data.micEnabled === "boolean") {
                    player.micEnabled = data.micEnabled;
                }

                broadcastPlayers();
            }

            if (data.type === "mic_toggle") {
                player.micEnabled = Boolean(data.enabled);

                broadcastPlayers();
            }
        } catch (err) {
            console.error("Invalid message:", err);
        }
    });

    ws.on("close", () => {
        players.delete(playerId);
        broadcastPlayers();
    });
});

function broadcastPlayers() {
    const data = [];

    for (const [id, player] of players) {
        data.push({
            id,
            username: player.username,
            x: player.x,
            y: player.y,
            z: player.z,
            micEnabled: player.micEnabled
        });
    }

    const message = JSON.stringify({
        type: "players",
        players: data
    });

    for (const [, player] of players) {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(message);
        }
    }
}

server.listen(PORT, () => {
    console.log(`MicBlox server running on port ${PORT}`);
});
