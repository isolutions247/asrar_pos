import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, menuItemsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

const moneyString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v))
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Invalid money value"));

const upsertSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  price: moneyString,
  image: z.string().max(2048).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  available: z.boolean().default(true),
});

router.get("/menu", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(menuItemsTable)
    .orderBy(asc(menuItemsTable.name));
  res.json({ items: rows });
});

router.post("/menu", requireAuth, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid item", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(menuItemsTable)
    .values({
      id: d.id,
      name: d.name,
      nameAr: d.nameAr ?? null,
      categoryId: d.categoryId ?? null,
      price: d.price,
      image: d.image ?? null,
      description: d.description ?? null,
      available: d.available,
    })
    .onConflictDoUpdate({
      target: menuItemsTable.id,
      set: {
        name: d.name,
        nameAr: d.nameAr ?? null,
        categoryId: d.categoryId ?? null,
        price: d.price,
        image: d.image ?? null,
        description: d.description ?? null,
        available: d.available,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({ item: row });
});

router.delete("/menu/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, id));
  res.json({ success: true });
});

const replaceAllSchema = z.object({ items: z.array(upsertSchema) });

router.put("/menu", requireAuth, async (req, res) => {
  const parsed = replaceAllSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(menuItemsTable);
    if (parsed.data.items.length > 0) {
      await tx.insert(menuItemsTable).values(
        parsed.data.items.map((d) => ({
          id: d.id,
          name: d.name,
          nameAr: d.nameAr ?? null,
          categoryId: d.categoryId ?? null,
          price: d.price,
          image: d.image ?? null,
          description: d.description ?? null,
          available: d.available,
        })),
      );
    }
  });
  res.json({ success: true, count: parsed.data.items.length });
});

export default router;
