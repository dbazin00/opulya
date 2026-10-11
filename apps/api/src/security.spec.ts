import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "./auth.js";
import type { Database } from "./db.js";
import type { MailService } from "./mail.js";
import {
  AuthGuard,
  cookieName,
  csrfProtection,
  hashToken,
  loginAccountKey,
  sessionCookieOptions,
  sessionPolicy,
} from "./security.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("session security", () => {
  it("blocks legacy unverified sessions from protected data", async () => {
    const updateMany = vi.fn();
    const guard = new AuthGuard({
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: "s",
          user: { id: "u", emailVerifiedAt: null },
        }),
        updateMany,
      },
    } as unknown as Database);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          path: "/api/accounts",
          cookies: { [cookieName()]: "b".repeat(64) },
        }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow(
      "EMAIL_NOT_VERIFIED",
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("cannot issue sessions to an unverified account even from an internal caller", async () => {
    const create = vi.fn(),
      cookie = vi.fn();
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      session: { create },
    };
    const db = {
      $transaction: async (action: (value: typeof tx) => Promise<unknown>) =>
        action(tx),
    } as unknown as Database;
    await expect(
      new AuthService(db, {} as MailService).startSession("pending", {
        cookie,
      } as unknown as Response),
    ).rejects.toThrow("EMAIL_NOT_VERIFIED");
    expect(create).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
  it("background portfolio polls validate expiry without extending inactivity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    vi.stubEnv("SESSION_HOURS", "8");
    vi.stubEnv("SESSION_IDLE_MINUTES", "15");
    const session = {
      id: "s",
      user: { id: "u", emailVerifiedAt: new Date() },
      createdAt: new Date("2026-10-09T10:00:00Z"),
      expiresAt: new Date("2026-10-09T18:00:00Z"),
      lastSeenAt: new Date("2026-10-09T11:50:00Z"),
    };
    const findUnique = vi.fn().mockResolvedValue(session),
      updateMany = vi.fn();
    const req = {
      method: "GET",
      path: "/api/accounts/a/portfolio",
      headers: { "x-opulya-poll": "1" },
      cookies: { [cookieName()]: "b".repeat(64) },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const guard = new AuthGuard({
      session: { findUnique, updateMany },
    } as unknown as Database);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-09T12:05:00Z"));
    await expect(guard.canActivate(context)).rejects.toThrow("UNAUTHORIZED");
    expect(updateMany).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-09T18:01:00Z"));
    session.lastSeenAt = new Date("2026-10-09T18:00:00Z");
    await expect(guard.canActivate(context)).rejects.toThrow("UNAUTHORIZED");
  });
  it("uses host-only, HttpOnly, Secure, Strict cookies in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieName()).toBe("__Host-opulya_session");
    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      priority: "high",
    });
    expect(sessionCookieOptions().domain).toBeUndefined();
  });

  it("validates timeout configuration and hashes normalized login identifiers", () => {
    vi.stubEnv("SESSION_HOURS", "8");
    vi.stubEnv("SESSION_IDLE_MINUTES", "15");
    expect(sessionPolicy()).toEqual({
      absoluteMs: 28_800_000,
      idleMs: 900_000,
    });
    const first = loginAccountKey({
      email: "  TEST@example.test ",
      password: "password",
    });
    expect(first).toBe(
      loginAccountKey({ email: "test@example.test", password: "password" }),
    );
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(
      loginAccountKey({ email: "not-an-email", password: "password" }),
    ).toBeNull();
    vi.stubEnv("SESSION_IDLE_MINUTES", "0");
    expect(() => sessionPolicy()).toThrow();
  });

  it("atomically replaces only the user's previous session and never stores the cookie token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    vi.stubEnv("SESSION_HOURS", "8");
    vi.stubEnv("SESSION_IDLE_MINUTES", "15");
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: "user-a" }) },
      session: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const transaction = vi.fn(
      async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const db = { $transaction: transaction } as unknown as Database;
    const cookie = vi.fn();
    const service = new AuthService(db, {} as MailService);
    const previous = "a".repeat(64);
    await service.startSession(
      "user-a",
      { cookie } as unknown as Response,
      previous,
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(cookie).toHaveBeenCalledOnce();
    const [call] = cookie.mock.calls;
    if (!call) throw new Error("Expected a session cookie");
    const token = call[1] as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toBe(previous);
    expect(tx.session.create).toHaveBeenCalledWith({
      data: {
        userId: "user-a",
        tokenHash: hashToken(token),
        expiresAt: new Date("2026-10-08T18:00:00Z"),
        lastSeenAt: new Date("2026-10-08T10:00:00Z"),
      },
    });
    expect(tx.session.deleteMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-a",
          OR: expect.arrayContaining([{ tokenHash: hashToken(previous) }]),
        }),
      }),
    );
    expect(cookie).toHaveBeenCalledWith(
      cookieName(),
      token,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        maxAge: 28_800_000,
      }),
    );
  });

  it("does not issue a cookie if saving the session fails", async () => {
    const db = {
      $transaction: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    } as unknown as Database;
    const cookie = vi.fn();
    await expect(
      new AuthService(db, {} as MailService).startSession("user", {
        cookie,
      } as unknown as Response),
    ).rejects.toThrow("database unavailable");
    expect(cookie).not.toHaveBeenCalled();
  });

  it("checks idle and absolute expiry atomically and never resurrects a revoked session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    vi.stubEnv("SESSION_HOURS", "8");
    vi.stubEnv("SESSION_IDLE_MINUTES", "15");
    const user = { id: "u", emailVerifiedAt: new Date() };
    const findUnique = vi.fn().mockResolvedValue({ id: "s", user });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const req = { cookies: { [cookieName()]: "b".repeat(64) } } as Request & {
      user?: unknown;
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const guard = new AuthGuard({
      session: { findUnique, updateMany },
    } as unknown as Database);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toBe(user);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "s",
        expiresAt: { gt: new Date("2026-10-08T10:00:00Z") },
        createdAt: { gt: new Date("2026-10-08T02:00:00Z") },
        lastSeenAt: { gt: new Date("2026-10-08T09:45:00Z") },
      },
      data: { lastSeenAt: new Date("2026-10-08T10:00:00Z") },
    });
    delete req.user;
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(guard.canActivate(context)).rejects.toThrow("UNAUTHORIZED");
    expect(req.user).toBeUndefined();
    expect(findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: hashToken("b".repeat(64)),
        }),
      }),
    );
  });

  it("rejects malformed session cookies before accessing the database", async () => {
    const findUnique = vi.fn();
    const guard = new AuthGuard({
      session: { findUnique },
    } as unknown as Database);
    for (const token of [
      undefined,
      "short",
      "g".repeat(64),
      ["a".repeat(64)],
    ]) {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ cookies: { [cookieName()]: token } }),
        }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toThrow("UNAUTHORIZED");
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("cross-site request protection", () => {
  it.each([
    ["GET", { "sec-fetch-site": "cross-site" }, false],
    [
      "POST",
      { origin: "https://attacker.example", "x-opulya-request": "1" },
      false,
    ],
    ["POST", { origin: "http://localhost:3000" }, false],
    [
      "POST",
      {
        origin: "http://localhost:3000",
        "x-opulya-request": "1",
        "sec-fetch-site": "cross-site",
      },
      false,
    ],
    [
      "POST",
      {
        origin: "http://localhost:3000",
        "x-opulya-request": "1",
        "sec-fetch-site": "same-origin",
      },
      true,
    ],
    ["GET", {}, true],
  ])("validates %s requests with %j", (method, headers, allowed) => {
    vi.stubEnv("WEB_ORIGIN", "http://localhost:3000");
    const req = { method, headers, is: () => true } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    csrfProtection(req, res as unknown as Response, next as NextFunction);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) expect(res.status).toHaveBeenCalledWith(403);
  });
});
