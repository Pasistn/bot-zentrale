import type { Db } from "./driver.js";

export let db: Db;

export function useDb(next: Db): void {
  db = next;
}
