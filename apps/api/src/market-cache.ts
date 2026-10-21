import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { z } from "@opulya/shared";
import type { Database } from "./db.js";

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const maxBytes = 512 * 1024;

/** Public provider data only. Tenant ownership is deliberately never cached here. */
export class MarketCache {
  private readonly memory = new Map<string, { at: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly db?: Database) {}
  async get<T>(
    key: string,
    ttl: number,
    schema: z.ZodType<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    const id = `yahoo:v2:${createHash("sha256").update(key).digest("hex")}`;
    const read = async (): Promise<T | null> => {
      const memory = this.memory.get(id);
      if (memory && memory.at > Date.now() - ttl) return memory.value as T;
      const saved = await this.db?.instrumentDirectoryCache.findUnique({
        where: { id },
      });
      if (
        !saved ||
        saved.version !== 1 ||
        saved.fetchedAt.getTime() <= Date.now() - ttl ||
        saved.fetchedAt.getTime() > Date.now() ||
        saved.payload.byteLength > maxBytes
      )
        return null;
      try {
        const bytes = await decompress(saved.payload, {
          maxOutputLength: maxBytes,
        });
        const value = schema.parse(JSON.parse(bytes.toString("utf8")));
        this.remember(id, saved.fetchedAt.getTime(), value);
        return value;
      } catch {
        return null;
      }
    };
    const saved = await read();
    if (saved !== null) return saved;
    const active = this.pending.get(id);
    if (active) return active as Promise<T>;
    const work = (async () => {
      const token = randomUUID();
      let locked = false;
      try {
        if (this.db) {
          await this.db.marketJob.upsert({
            where: { id },
            create: { id, leaseUntil: new Date(0) },
            update: {},
          });
          locked = !!(
            await this.db.marketJob.updateMany({
              where: { id, leaseUntil: { lte: new Date() } },
              data: { token, leaseUntil: new Date(Date.now() + 120000) },
            })
          ).count;
          if (!locked) {
            for (let i = 0; i < 100; i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              const value = await read();
              if (value !== null) return value;
            }
            throw new Error("MARKET_UNAVAILABLE");
          }
          const value = await read();
          if (value !== null) return value;
        }
        const value = schema.parse(await load()),
          fetchedAt = new Date();
        const json = JSON.stringify(value);
        if (Buffer.byteLength(json) > maxBytes)
          throw new Error("MARKET_UNAVAILABLE");
        if (this.db) {
          const data = { version: 1, fetchedAt, payload: await compress(json) };
          await this.db.instrumentDirectoryCache.upsert({
            where: { id },
            create: { id, ...data },
            update: data,
          });
          const expired = await this.db.instrumentDirectoryCache.findMany({
            where: { id: { startsWith: "yahoo:v2:" } },
            orderBy: { fetchedAt: "desc" },
            skip: 500,
            select: { id: true },
          });
          if (expired.length) {
            await this.db.instrumentDirectoryCache.deleteMany({
              where: { id: { in: expired.map((row) => row.id) } },
            });
          }
        }
        this.remember(id, fetchedAt.getTime(), value);
        return value;
      } finally {
        if (this.db && locked)
          await this.db.marketJob.deleteMany({
            where: { id, token },
          });
      }
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return work;
  }
  private remember(id: string, at: number, value: unknown) {
    if (this.memory.size >= 200)
      this.memory.delete(this.memory.keys().next().value!);
    this.memory.set(id, { at, value });
  }
}
