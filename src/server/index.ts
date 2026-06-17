// Bun-native fullstack server: serves the React app and the local-data API
// from a single process. No external services; reads only ~/.claude and ~/.codex.

import { watch } from "node:fs";
import { getAnalytics, getSession, listSessions } from "../lib/discovery";
import index from "../frontend/index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 19876),
  development: process.env.NODE_ENV !== "production",

  routes: {
    "/": index,

    "/api/sessions": async () => {
      return Response.json(await listSessions());
    },

    // Cross-session analytics aggregated across every discovered session.
    "/api/analytics": async () => {
      return Response.json(await getAnalytics());
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

    // Live tail: Server-Sent Events stream that re-parses & pushes the session
    // whenever its file changes on disk.
    "/api/watch": (req) => {
      const url = new URL(req.url);
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return Response.json({ error: "missing path" }, { status: 400 });
      }

      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let closed = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          const push = async () => {
            if (closed) return;
            const session = await getSession(filePath);
            if (session && !closed) {
              try {
                controller.enqueue(
                  enc.encode(`data: ${JSON.stringify(session)}\n\n`),
                );
              } catch {
                /* stream already closed */
              }
            }
          };

          let watcher: ReturnType<typeof watch> | null = null;
          const cleanup = () => {
            if (closed) return;
            closed = true;
            if (timer) clearTimeout(timer);
            watcher?.close();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };

          // OpenCode/Cursor sessions use synthetic ids (not real files), so
          // there's nothing to fs.watch — just send the current snapshot.
          if (!filePath.includes(":") || /^[a-zA-Z]:[\\/]/.test(filePath)) {
            try {
              watcher = watch(filePath, () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(push, 250); // debounce rapid writes
              });
            } catch {
              /* not a watchable path; snapshot only */
            }
          }

          void push(); // send current state immediately
          req.signal.addEventListener("abort", cleanup);
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },
  },

  error(err) {
    console.error(err);
    return Response.json({ error: String(err) }, { status: 500 });
  },
});

console.log(`▸ Coding Agent Visualizer running at ${server.url}`);
