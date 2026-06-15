// Bun-native fullstack server: serves the React app and the local-data API
// from a single process. No external services; reads only ~/.claude and ~/.codex.

import { getSession, listSessions } from "../lib/discovery";
import index from "../frontend/index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",

  routes: {
    "/": index,

    "/api/sessions": async () => {
      return Response.json(await listSessions());
    },

    "/api/session": async (req) => {
      const url = new URL(req.url);
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return Response.json({ error: "missing path" }, { status: 400 });
      }
      const session = await getSession(filePath);
      if (!session) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json(session);
    },
  },

  error(err) {
    console.error(err);
    return Response.json({ error: String(err) }, { status: 500 });
  },
});

console.log(`▸ Coding Agent Visualizer running at ${server.url}`);
