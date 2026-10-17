import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/main.js", ["main.js", "text/javascript; charset=utf-8"]],
  ["/prices.js", ["prices.js", "text/javascript; charset=utf-8"]],
]);

const server = createServer(async (request, response) => {
  const asset = assets.get(new URL(request.url ?? "/", "http://localhost").pathname);
  if (!asset || !["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(new URL(`../dist/${asset[0]}`, import.meta.url));
    response.writeHead(200, {
      "Content-Type": asset[1]!,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error("Could not serve built asset. Run npm run build first.", error);
    response.writeHead(500).end("Could not load application. Run npm run build first.");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Spotprice is ready at http://127.0.0.1:${port}`);
});
