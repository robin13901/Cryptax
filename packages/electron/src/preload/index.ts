import { contextBridge } from 'electron';

/**
 * Minimal preload script.
 * The Cryptax frontend communicates with the backend entirely via HTTP fetch
 * to localhost:3001. No IPC channels are needed.
 *
 * We expose only the platform identifier for potential OS-specific UI tweaks.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
