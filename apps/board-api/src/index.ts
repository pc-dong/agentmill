import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { createApp } from "./routes.js";

const dataDir = process.env.AIW_DATA_DIR ?? path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "board.sqlite");
const db = openDb(dbPath);
migrate(db);
const app = createApp(new BoardRepo(db));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`board-api listening on http://127.0.0.1:${port}`);
console.log(`sqlite: ${dbPath}`);
