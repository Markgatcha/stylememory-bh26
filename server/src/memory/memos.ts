import { MemOS } from "@mem-os/sdk";
import { DB_PATH } from "../paths.js";

/** Single namespace for all StyleMemory records. Tags are the primary discriminator. */
export const NAMESPACE = "stylememory";

let memosInstance: MemOS | null = null;
let initPromise: Promise<MemOS> | null = null;

/**
 * Get the MemOS singleton. Race-safe: concurrent callers share the same init() promise.
 * The SQLite file is created by init() — the data/ dir must exist first (call ensureDirs()).
 */
export function getMemOS(): Promise<MemOS> {
  if (memosInstance) return Promise.resolve(memosInstance);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const memos = new MemOS({
      dbPath: DB_PATH,
      experimental: { namespaces: true },
    });
    await memos.init();
    memosInstance = memos;
    console.log(`[memos] ready — db: ${DB_PATH}`);
    return memos;
  })();

  return initPromise;
}

/** Close the MemOS connection cleanly. Used on SIGINT shutdown. */
export async function closeMemOS(): Promise<void> {
  if (memosInstance) {
    await memosInstance.close();
    memosInstance = null;
    initPromise = null;
    console.log("[memos] closed");
  }
}
