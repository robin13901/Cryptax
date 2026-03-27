import { app } from 'electron';
import path from 'node:path';

/**
 * Resolve the SQLite database file path in the user's app data directory.
 * On Windows: %APPDATA%/Cryptax/cryptax.db
 * On macOS: ~/Library/Application Support/Cryptax/cryptax.db
 * On Linux: ~/.config/Cryptax/cryptax.db
 */
export function resolveDbPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'cryptax.db');
}

/**
 * Resolve the path to the Drizzle migration files.
 * In production (packaged): reads from process.resourcesPath/drizzle (placed by extraResources)
 * In development: points directly to the backend's source drizzle folder
 * Returns the path to the migrations folder.
 */
export function resolveMigrationsPath(): string {
  if (app.isPackaged) {
    // In production: migrations are in resources/drizzle via extraResources in electron-builder.yml
    return path.join(process.resourcesPath, 'drizzle');
  }
  // In development: use the backend's source drizzle folder directly
  // out/main/ -> out/ -> electron/ -> packages/ = 3 levels. Then backend/drizzle.
  return path.resolve(__dirname, '../../../backend/drizzle');
}
