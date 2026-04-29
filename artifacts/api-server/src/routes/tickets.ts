import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ticketsTable, settingsTable } from "@workspace/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

// The "ticket counter" effective reset point is whichever is more recent:
// today's restaurant-local midnight (auto-daily reset) OR the last manual
// reset timestamp stored in the settings KV table under "tickets.lastReset".
//
// Counting tickets created since that point gives us the next ticket number
// for the day. The counter naturally rolls over at midnight (Asia/Riyadh)
// and can also be reset on demand by an admin.
const RESET_KEY = "tickets.lastReset";

// Restaurant timezone: Saudi Arabia (UTC+3, no DST).
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

// Postgres advisory lock id used to serialise generate + reset operations
// for the tickets feature. Any non-negative bigint works; we picked an
// arbitrary constant unique to this app's namespace.
const TICKETS_LOCK_ID = 7340271;

function todayMidnightRiyadh(): Date {
  // "now" shifted into Riyadh local time, floored to that day's start, then
  // shifted back to UTC. Equivalent to "the most recent 00:00 in Riyadh".
  const nowMs = Date.now();
  const riyadhNow = nowMs + RIYADH_OFFSET_MS;
  const dayStartUtcMs =
    Math.floor(riyadhNow / 86400000) * 86400000 - RIYADH_OFFSET_MS;
  return new Date(dayStartUtcMs);
}

async function getEffectiveResetAt(
  // Optional drizzle transaction handle so callers inside a txn use the same
  // visibility as their other queries.
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<Date> {
  const [row] = await tx
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, RESET_KEY));
  const stored =
    row?.value && typeof row.value === "object" && "at" in row.value
      ? new Date((row.value as { at: string }).at)
      : null;
  const todayMidnight = todayMidnightRiyadh();
  if (!stored || isNaN(stored.getTime())) return todayMidnight;
  return stored > todayMidnight ? stored : todayMidnight;
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

// GET /api/tickets/today --- list today's tickets (since the effective reset)
router.get("/tickets/today", requireAuth, async (_req, res) => {
  const since = await getEffectiveResetAt();
  const rows = await db
    .select()
    .from(ticketsTable)
    .where(gte(ticketsTable.createdAt, since))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(200);
  res.json({
    tickets: rows,
    resetAt: since.toISOString(),
    count: rows.length,
  });
});

// GET /api/tickets/next-preview --- what number the next generate will use
router.get("/tickets/next-preview", requireAuth, async (_req, res) => {
  const since = await getEffectiveResetAt();
  const [latest] = await db
    .select()
    .from(ticketsTable)
    .where(gte(ticketsTable.createdAt, since))
    .orderBy(desc(ticketsTable.number))
    .limit(1);
  const next = (latest?.number ?? 0) + 1;
  res.json({
    nextNumber: next,
    nextLabel: `T-${pad(next)}`,
    resetAt: since.toISOString(),
  });
});

// POST /api/tickets/generate --- create the next ticket
//
// Note: this app authenticates via a client-side PIN/role login screen — the
// API server does not own the role concept. Cashier identity is supplied by
// the client (mirrors how /api/orders accepts the cashier name).
const generateSchema = z.object({
  counterName: z.string().max(80).nullable().optional(),
  cashier: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.post("/tickets/generate", requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }
  // Wrap generate in a transaction protected by a Postgres advisory lock so
  // (a) two concurrent generates cannot pick the same ticket number, and
  // (b) a reset cannot interleave between "compute since" and "insert".
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${TICKETS_LOCK_ID})`);
    const since = await getEffectiveResetAt(tx);
    const [latest] = await tx
      .select()
      .from(ticketsTable)
      .where(gte(ticketsTable.createdAt, since))
      .orderBy(desc(ticketsTable.number))
      .limit(1);
    const nextNumber = (latest?.number ?? 0) + 1;
    const [row] = await tx
      .insert(ticketsTable)
      .values({
        number: nextNumber,
        label: `T-${pad(nextNumber)}`,
        counterName: parsed.data.counterName ?? null,
        cashier: parsed.data.cashier ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return row;
  });
  res.status(201).json({ ticket: created });
});

// POST /api/tickets/reset --- manual reset
//
// Role enforcement happens client-side (the Reset button is only rendered
// for admin sessions), consistent with the rest of this API surface.
//
// Acquires the same advisory lock as generate so an in-flight generate
// cannot straddle the reset boundary.
router.post("/tickets/reset", requireAuth, async (_req, res) => {
  const at = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${TICKETS_LOCK_ID})`);
    await tx
      .insert(settingsTable)
      .values({ key: RESET_KEY, value: { at: at.toISOString() } })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: { at: at.toISOString() } },
      });
  });
  res.json({ ok: true, resetAt: at.toISOString() });
});

export default router;
