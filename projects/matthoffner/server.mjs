import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const sendFile = async (filePath, res) => {
  const ext = path.extname(filePath);
  const type = contentTypes[ext] || "application/octet-stream";
  const fileStat = await stat(filePath);

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": fileStat.size,
    "Cache-Control": "no-store"
  });

  createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    let filePath = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    await sendFile(filePath, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Server error\n${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log("Matthoffner site ready");
  console.log(url);
});
