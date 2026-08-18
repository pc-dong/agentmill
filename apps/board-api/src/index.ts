import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { createApp } from "./routes.js";
import { SessionRepo } from "./sessions.js";
import { WsHub } from "./wsHub.js";

const dataDir =
  process.env.AM_DATA_DIR ??
  process.env.AIW_DATA_DIR ??
  path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "board.sqlite");
const db = openDb(dbPath);
migrate(db);
const repo = new BoardRepo(db);
const sessions = new SessionRepo(db);
const hub = new WsHub(sessions);
const app = createApp(repo, sessions);

const port = Number(process.env.PORT ?? 8787);
const server = createServer(getRequestListener(app.fetch));
server.listen(port, () => {
  console.log(`board-api listening on http://127.0.0.1:${port}`);
  console.log(`websocket: ws://127.0.0.1:${port}`);
  console.log(`sqlite: ${dbPath}`);
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => hub.handleConnection(ws));
