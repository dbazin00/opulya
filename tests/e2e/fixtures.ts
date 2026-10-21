import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { test as base, type Locator } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assetTypes, signupSchema, signupPasswordSchema } from "@opulya/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";

export async function catalogueFixture(input: {
  symbol: string;
  name: string;
  assetType: "STOCK" | "ETF" | "CRYPTO" | "FUND";
  currency: string;
  exchange?: string;
}) {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Catalogue fixtures require opulya_test");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const row = {
    ...input,
    symbol:
      input.assetType === "CRYPTO" && !input.symbol.includes("/")
        ? `${input.symbol}/${input.currency}`
        : input.symbol,
    exchange: input.exchange ?? "Binance",
    mic: input.assetType === "CRYPTO" ? "" : "XETR",
    timeZone: input.assetType === "CRYPTO" ? "UTC" : "Europe/Berlin",
    isin: null,
  };
  try {
    const existing = await db.instrumentMapping.findUnique({
      where: {
        provider_symbol_exchange_mic_currency: {
          provider: "Yahoo Finance",
          symbol: row.symbol,
          exchange: row.exchange,
          mic: row.mic,
          currency: row.currency,
        },
      },
    });
    if (existing)
      return await db.instrument.update({
        where: { id: existing.instrumentId },
        data: { name: row.name },
      });
    return await db.instrument.create({
      data: {
        ...row,
        identity: randomUUID(),
        mappings: {
          create: {
            provider: "Yahoo Finance",
            symbol: row.symbol,
            exchange: row.exchange,
            mic: row.mic,
            currency: row.currency,
          },
        },
      },
    });
  } finally {
    await db.$disconnect();
  }
}

export { expect, type Page } from "@playwright/test";

export async function chooseOption(
  picker: Locator,
  value: string | { label: string },
) {
  await picker.click();
  const page = picker.page();
  if (typeof value === "string") {
    await page
      .getByRole("option")
      .and(page.locator(`[data-value=${JSON.stringify(value)}]`))
      .click();
  } else {
    await page.getByRole("option", { name: value.label, exact: true }).click();
  }
}

export async function verificationMail(email: string) {
  const directory = fileURLToPath(
    new URL("../../.runtime/e2e-mail/", import.meta.url),
  );
  const file = join(
    directory,
    `${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}.json`,
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as {
        to: string;
        locale: string;
        verificationUrl: string;
        minutes: number;
      };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Test verification mail was not delivered");
}
export async function removeVerificationMail(email: string) {
  const directory = fileURLToPath(
    new URL("../../.runtime/e2e-mail/", import.meta.url),
  );
  await unlink(
    join(
      directory,
      `${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}.json`,
    ),
  ).catch(() => undefined);
}
export const test = base.extend<{
  apiRateBudget: void;
  autoVerifySignup: boolean;
}>({
  autoVerifySignup: [true, { option: true }],
  page: async ({ page, autoVerifySignup }, use) => {
    const database = testDatabaseUrl();
    if (new URL(database).pathname !== "/opulya_test")
      throw new Error("Browser fixtures require opulya_test");
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: database }),
    });
    // Browser tests use isolated DB instruments as an offline provider fixture.
    // Tests of live discovery override this route with their own controlled responses.
    await page.route("**/api/instruments/directory?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const ownedResponse = await page.request.get("/api/assets");
      if (!ownedResponse.ok()) {
        await route.fulfill({ response: ownedResponse });
        return;
      }
      const search = query.get("search") ?? "";
      const assetType = assetTypes.find(
        (type) => type === query.get("assetType"),
      );
      const rows = await db.instrument.findMany({
        where: {
          mappings: { some: { provider: "Yahoo Finance" } },
          currency: query.get("currency") ?? "EUR",
          ...(assetType ? { assetType } : {}),
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { symbol: { contains: search, mode: "insensitive" } },
            { isin: { equals: search.toUpperCase() } },
          ],
        },
        orderBy: [{ symbol: "asc" }, { exchange: "asc" }],
        take: 50,
      });
      const owned = await ownedResponse.json();
      const items = rows.filter(
        (row: { id: string }) =>
          !owned.some(
            (asset: { instrumentId: string }) => asset.instrumentId === row.id,
          ),
      );
      await route.fulfill({
        json: {
          items,
          total: items.length,
          ownedCount: rows.length - items.length,
          page: 0,
          hasMore: false,
        },
      });
    });
    const post = page.request.post.bind(page.request);
    if (autoVerifySignup) {
      page.request.post = async (url, options) => {
        const signingUp =
          new URL(url, "http://localhost:3001").pathname === "/api/auth/signup";
        const input = signingUp
          ? signupSchema
              .extend({ password: signupPasswordSchema })
              .parse(options?.data)
          : undefined;
        const registration = input
          ? ({ ...input } as Partial<typeof input>)
          : undefined;
        if (registration) delete registration.password;
        const response = await post(
          url,
          registration ? { ...options, data: registration } : options,
        );
        if (
          new URL(url, "http://localhost:3001").pathname !==
            "/api/auth/signup" ||
          response.status() !== 201
        )
          return response;
        if (!input) throw new Error("Missing signup fixture");
        const mail = await verificationMail(input.email);
        const token = new URLSearchParams(
          new URL(mail.verificationUrl).hash.slice(1),
        ).get("token");
        const headers = {
          Origin: "http://localhost:3001",
          "X-Opulya-Request": "1",
        };
        const verified = await post("/api/auth/verify-email", {
          headers,
          data: { token, password: input.password },
        });
        if (!verified.ok())
          throw new Error("Test fixture email verification failed");
        const login = await post("/api/auth/login", {
          headers,
          data: { email: input.email, password: input.password },
        });
        if (!login.ok()) throw new Error("Verified test fixture login failed");
        await removeVerificationMail(input.email);
        return login;
      };
    }
    try {
      await use(page);
    } finally {
      await db.$disconnect();
    }
  },
  apiRateBudget: [
    async ({ request }, use) => {
      // Journeys share one loopback IP. Respect the real API limit between tests.
      const response = await request.get("/api/health");
      const rate = response.headers()["ratelimit"] ?? "";
      const remaining = /(?:^|;)\s*r=(\d+)/.exec(rate)?.[1];
      const reset = /(?:^|;)\s*t=(\d+)/.exec(rate)?.[1];
      if (
        remaining !== undefined &&
        Number(remaining) < 120 &&
        reset !== undefined
      )
        await new Promise((resolve) =>
          setTimeout(resolve, (Number(reset) + 1) * 1000),
        );
      await use();
    },
    { auto: true },
  ],
});
