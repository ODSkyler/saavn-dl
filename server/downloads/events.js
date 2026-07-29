/**
 * Server-Sent Events broker for the download queue.
 *
 * Tracks connected SSE clients and broadcasts QueueState snapshots. On connect a client
 * immediately receives the current full state (Req 4.3). A periodic comment heartbeat
 * keeps intermediaries from closing idle connections.
 */

const clients = new Set();
let heartbeat = null;

const HEARTBEAT_MS = 25_000;

function writeState(res, state) {
  try {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  } catch {
    // Broken pipe — drop the client.
    clients.delete(res);
  }
}

function ensureHeartbeat() {
  if (heartbeat || clients.size === 0) return;
  heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clients.delete(res);
      }
    }
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }, HEARTBEAT_MS);
  // Don't keep the process alive solely for the heartbeat.
  if (heartbeat.unref) heartbeat.unref();
}

/**
 * Register an SSE client. Writes SSE headers, sends the current state, and wires
 * cleanup on disconnect.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {object} currentState  the QueueState to send immediately
 */
export function addSseClient(req, res, currentState) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });

  clients.add(res);
  ensureHeartbeat();

  // Initial snapshot.
  writeState(res, currentState);

  const cleanup = () => {
    clients.delete(res);
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

/** Broadcast a QueueState snapshot to all connected clients. */
export function broadcast(state) {
  for (const res of clients) writeState(res, state);
}

export function clientCount() {
  return clients.size;
}
