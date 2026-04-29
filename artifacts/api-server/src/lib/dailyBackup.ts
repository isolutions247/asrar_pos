import fs from "node:fs/promises";
import path from "node:path";
import { db, ordersTable, orderItemsTable, paymentsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

// Backups land in <repo-root>/backups so they survive across rebuilds.
// (process.cwd() inside the api-server workflow is the api-server dir.)
const BACKUP_DIR = path.resolve(process.cwd(), "..", "..", "backups");

export interface BackupResult {
  filePath: string;
  ordersCount: number;
  bytes: number;
}

export async function runBackup(): Promise<BackupResult> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const orders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));
  const items = await db.select().from(orderItemsTable);
  const payments = await db.select().from(paymentsTable);

  const itemsByOrder = new Map<string, typeof items>();
  for (const it of items) {
    if (!itemsByOrder.has(it.orderId)) itemsByOrder.set(it.orderId, []);
    itemsByOrder.get(it.orderId)!.push(it);
  }
  const paymentsByOrder = new Map<string, typeof payments>();
  for (const p of payments) {
    if (!paymentsByOrder.has(p.orderId)) paymentsByOrder.set(p.orderId, []);
    paymentsByOrder.get(p.orderId)!.push(p);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    ordersCount: orders.length,
    orders: orders.map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
      payments: paymentsByOrder.get(o.id) ?? [],
    })),
  };

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(BACKUP_DIR, `orders-${today}.json`);
  const text = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, text, "utf8");

  return { filePath, ordersCount: orders.length, bytes: Buffer.byteLength(text) };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the daily backup loop.
 * - Runs once shortly after boot (10s delay).
 * - Then runs every 24h.
 *
 * Using setInterval keeps the implementation dependency-free; fine for the
 * always-on dev workflow and Reserved-VM deployments. For Autoscale
 * deployments, prefer Replit Scheduled Deployments and call POST /api/backup/run.
 */
export function startDailyBackup() {
  if (timer) return;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // First run after boot
  setTimeout(() => {
    runBackup()
      .then((r) =>
        logger.info(
          { file: r.filePath, ordersCount: r.ordersCount, bytes: r.bytes },
          "Initial backup written",
        ),
      )
      .catch((err) => logger.error({ err }, "Initial backup failed"));
  }, 10_000);

  // Daily thereafter
  timer = setInterval(() => {
    runBackup()
      .then((r) =>
        logger.info(
          { file: r.filePath, ordersCount: r.ordersCount, bytes: r.bytes },
          "Daily backup written",
        ),
      )
      .catch((err) => logger.error({ err }, "Daily backup failed"));
  }, ONE_DAY_MS);
}
