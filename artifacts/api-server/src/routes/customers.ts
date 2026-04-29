import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, customersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

const upsertSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  notes: z.string().max(2000).nullable().optional(),
});

router.get("/customers", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(customersTable)
    .orderBy(asc(customersTable.name));
  res.json({ customers: rows });
});

router.post("/customers", requireAuth, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(customersTable)
    .values({
      id: d.id,
      name: d.name,
      phone: d.phone ?? null,
      email: d.email ?? null,
      notes: d.notes ?? null,
    })
    .onConflictDoUpdate({
      target: customersTable.id,
      set: {
        name: d.name,
        phone: d.phone ?? null,
        email: d.email ?? null,
        notes: d.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({ customer: row });
});

router.delete("/customers/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db.delete(customersTable).where(eq(customersTable.id, id));
  res.json({ success: true });
});

export default router;
