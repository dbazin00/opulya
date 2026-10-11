import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { assetSchema, timeZoneSchema, z } from "@opulya/shared";
import { Database } from "./db.js";
import type { InstrumentInput } from "./instruments.js";

export const directoryTypes = ["STOCK", "ETF", "CRYPTO", "FUND"] as const;
export type DirectoryType = (typeof directoryTypes)[number];
const compress = promisify(gzip),
  decompress = promisify(gunzip);
const maxBytes = 128 * 1024 * 1024;
const rowsSchema = z
  .array(
    z
      .object({
        symbol: assetSchema.shape.symbol,
        name: assetSchema.shape.name,
        exchange: assetSchema.shape.exchange,
        currency: assetSchema.shape.currency,
        assetType: z.enum(directoryTypes),
        mic: z.string().regex(/^(?:[A-Z0-9]{4})?$/),
        isin: z
          .string()
          .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/)
          .nullable(),
        timeZone: timeZoneSchema,
      })
      .refine((row) =>
        row.assetType === "CRYPTO"
          ? row.symbol.split("/")[1] === row.currency
          : !!row.exchange,
      ),
  )
  .max(500000);
export type ReferenceSnapshot = { rows: InstrumentInput[]; fetchedAt: Date };
export const referenceCacheId = (type: DirectoryType) =>
  `alpha-vantage:directory:v1:${type}`;
export const referenceFresh = (at: Date) =>
  at.getTime() > Date.now() - 86400000 && at.getTime() <= Date.now();

@Injectable()
export class ReferenceCache {
  constructor(@Inject(Database) private readonly db: Database) {}
  async read(
    type: DirectoryType,
    currency?: string,
  ): Promise<ReferenceSnapshot | null> {
    const saved = await this.db.instrumentDirectoryCache.findUnique({
      where: { id: referenceCacheId(type) },
    });
    if (
      !saved ||
      saved.version !== 1 ||
      saved.payload.byteLength > maxBytes ||
      saved.fetchedAt.getTime() > Date.now() + 60000
    )
      return null;
    try {
      const json = await decompress(saved.payload, {
        maxOutputLength: maxBytes,
      });
      const value: unknown = JSON.parse(json.toString("utf8"));
      if (!Array.isArray(value) || value.length > 500000) return null;
      return {
        rows: rowsSchema.parse(
          currency
            ? value.filter(
                (row) =>
                  typeof row === "object" &&
                  row !== null &&
                  row.currency === currency,
              )
            : value,
        ),
        fetchedAt: saved.fetchedAt,
      };
    } catch {
      return null;
    }
  }
  async refresh(
    type: DirectoryType,
    retrieve: () => Promise<InstrumentInput[]>,
  ): Promise<ReferenceSnapshot> {
    const id = referenceCacheId(type),
      token = randomUUID();
    const fresh = await this.read(type);
    if (fresh && referenceFresh(fresh.fetchedAt)) return fresh;
    await this.db.marketJob.upsert({
      where: { id },
      create: { id, leaseUntil: new Date(0) },
      update: {},
    });
    const locked = await this.db.marketJob.updateMany({
      where: { id, leaseUntil: { lt: new Date() } },
      data: { token, leaseUntil: new Date(Date.now() + 300000) },
    });
    if (!locked.count) {
      // Another API instance is publishing the same public reference feed; do not duplicate its request.
      for (let i = 0; i < 45; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const saved = await this.read(type);
        if (saved && referenceFresh(saved.fetchedAt)) return saved;
      }
      throw new Error("MARKET_UNAVAILABLE");
    }
    try {
      const cached = await this.read(type);
      if (cached && referenceFresh(cached.fetchedAt)) return cached;
      const rows = rowsSchema.parse(await retrieve());
      const json = JSON.stringify(rows);
      if (Buffer.byteLength(json) > maxBytes)
        throw new Error("MARKET_UNAVAILABLE");
      const snapshot = { rows, fetchedAt: new Date() };
      const data = {
        version: 1,
        payload: await compress(json, { level: 1 }),
        fetchedAt: snapshot.fetchedAt,
      };
      await this.db.instrumentDirectoryCache.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
      return snapshot;
    } finally {
      await this.db.marketJob.updateMany({
        where: { id, token },
        data: { token: null, leaseUntil: new Date(0) },
      });
    }
  }
}
