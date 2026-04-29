import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, categoriesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

const upsertSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().min(0).default(0),
});

router.get("/categories", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder), asc(categoriesTable.name));
  res.json({ categories: rows });
});

router.post("/categories", requireAuth, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid category", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const [row] = await db
    .insert(categoriesTable)
    .values({ id: data.id, name: data.name, sortOrder: data.sortOrder })
    .onConflictDoUpdate({
      target: categoriesTable.id,
      set: { name: data.name, sortOrder: data.sortOrder, updatedAt: new Date() },
    })
    .returning();
  res.json({ category: row });
});

router.delete("/categories/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.json({ success: true });
});

const replaceAllSchema = z.object({
  categories: z.array(upsertSchema),
});

router.put("/categories", requireAuth, async (req, res) => {
  const parsed = replaceAllSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(categoriesTable);
    if (parsed.data.categories.length > 0) {
      await tx.insert(categoriesTable).values(parsed.data.categories);
    }
  });
  res.json({ success: true, count: parsed.data.categories.length });
});

export default router;
