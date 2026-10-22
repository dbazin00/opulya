import { mkdir, readFile, writeFile } from "node:fs/promises";
import { coverageBadge } from "./coverage-badge.js";

const summary = JSON.parse(
  await readFile("coverage/unit/coverage-summary.json", "utf8"),
) as { total?: { lines?: { pct?: unknown } } } | null;
const badge = coverageBadge(summary?.total?.lines?.pct);

await mkdir("coverage/badge", { recursive: true });
await writeFile("coverage/badge/coverage.svg", badge);
