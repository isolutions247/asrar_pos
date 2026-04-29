import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

router.get("/settings/:key", requireAuth, async (req, res) => {
  const key = req.params.key;
  if (!key || Array.isArray(key)) {
    res.status(400).json({ error: "Missing key" });
    return;
  }
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key));
  res.json({ value: row?.value ?? null, updatedAt: row?.updatedAt ?? null });
});

const putSchema = z.object({
  value: z.unknown(),
});

router.put("/settings/:key", requireAuth, async (req, res) => {
  const key = req.params.key;
  const parsed = putSchema.safeParse(req.body);
  if (!key || Array.isArray(key)) {
    res.status(400).json({ error: "Missing key" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  const value = (parsed.data.value ?? null) as Record<string, unknown> | null;
  await db
    .insert(settingsTable)
    .values({ key, value: value as Record<string, unknown> })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: value as Record<string, unknown>, updatedAt: new Date() },
    });
  res.json({ success: true });
});

export default router;
