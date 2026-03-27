import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';

let serverInstance: ServerType | null = null;

/**
 * Start the Hono backend server on the given port.
 * Uses dynamic import to load the backend AFTER initDb() has been called explicitly.
 */
export async function startBackendServer(port = 3001): Promise<void> {
  const { createApp } = await import('@cryptax/backend/app.js');

  const app = createApp();

  return new Promise<void>((resolve) => {
    serverInstance = serve({ fetch: app.fetch, port }, () => {
      console.log(`[electron] Backend server running on http://localhost:${port}`);
      resolve();
    });
  });
}

/**
 * Stop the embedded backend server gracefully.
 */
export function stopBackendServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
