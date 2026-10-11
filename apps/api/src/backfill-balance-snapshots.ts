import "reflect-metadata";
import "dotenv/config";
import { Database } from "./db.js";
import { refreshBalanceSnapshots } from "./balance-snapshots.js";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for snapshot rebuilding");
const db = new Database();
try {
  const users = await db.user.findMany({ select: { id: true } });
  for (const user of users)
    await db.atomic(user.id, (tx) => refreshBalanceSnapshots(tx, user.id));
  console.log("Balance snapshots rebuilt", { users: users.length });
} catch {
  console.error("Balance snapshot rebuild failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
