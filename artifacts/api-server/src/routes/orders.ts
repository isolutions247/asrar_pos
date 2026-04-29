import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  ordersTable,
  orderItemsTable,
  paymentsTable,
  settingsTable,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

// Tiny HTML escape so we can safely interpolate user-controlled fields
// (item names, customer names, notes) into the public invoice page.
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Money helpers --------------------------------------------------------------
const moneyString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v))
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Invalid money value"));

// Rate (e.g. VAT rate 0.1500) is stored as numeric(6,4) — allow up to 4 decimals
const rateString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v.toFixed(4) : v))
  .pipe(z.string().regex(/^-?\d+(\.\d{1,4})?$/, "Invalid rate value"));

const orderItemSchema = z.object({
  menuItemId: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).nullable().optional(),
  unitPrice: moneyString,
  quantity: z.number().int().positive().max(10_000),
  lineTotal: moneyString,
});

const placeOrderSchema = z.object({
  id: z.string().min(1).max(64), // display id, e.g. "ORD-1042"
  orderNumber: z.number().int().nonnegative(),
  status: z.enum(["completed", "refunded", "held"]).default("completed"),
  paymentMethod: z.string().min(1).max(40),
  cashier: z.string().max(80).nullable().optional(),

  customerId: z.string().max(64).nullable().optional(),
  customerName: z.string().max(200).nullable().optional(),

  gross: moneyString,
  discountType: z.enum(["percent", "fixed"]).nullable().optional(),
  discountValue: moneyString.optional(),
  discountAmount: moneyString,
  total: moneyString,
  subtotal: moneyString,
  vatAmount: moneyString,
  vatRate: rateString,

  notes: z.string().max(2000).nullable().optional(),
  extras: z.record(z.string(), z.unknown()).nullable().optional(),

  items: z.array(orderItemSchema).min(1, "Order must have at least one item"),
  payments: z
    .array(
      z.object({
        method: z.string().min(1).max(40),
        amount: moneyString,
        reference: z.string().max(120).nullable().optional(),
      }),
    )
    .optional(),

  createdAt: z.coerce.date().optional(),
});

// POST /api/orders --- transactional order placement -------------------------
router.post("/orders", requireAuth, async (req, res) => {
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid order",
      details: parsed.error.flatten(),
    });
    return;
  }
  const d = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // Insert (or upsert) the order header
      const [order] = await tx
        .insert(ordersTable)
        .values({
          id: d.id,
          orderNumber: d.orderNumber,
          status: d.status,
          paymentMethod: d.paymentMethod,
          cashier: d.cashier ?? null,
          customerId: d.customerId ?? null,
          customerName: d.customerName ?? null,
          gross: d.gross,
          discountType: d.discountType ?? null,
          discountValue: d.discountValue ?? "0",
          discountAmount: d.discountAmount,
          total: d.total,
          subtotal: d.subtotal,
          vatAmount: d.vatAmount,
          vatRate: d.vatRate,
          notes: d.notes ?? null,
          extras: d.extras ?? null,
          ...(d.createdAt ? { createdAt: d.createdAt } : {}),
        })
        .onConflictDoNothing()
        .returning();

      // If conflict, the order already exists — return what's stored.
      if (!order) {
        const [existing] = await tx
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.id, d.id));
        return { order: existing, alreadyExisted: true as const };
      }

      // Items
      await tx.insert(orderItemsTable).values(
        d.items.map((it) => ({
          orderId: d.id,
          menuItemId: it.menuItemId ?? null,
          name: it.name,
          nameAr: it.nameAr ?? null,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          lineTotal: it.lineTotal,
        })),
      );

      // Payments — default to a single payment for the full amount if not provided
      const payments =
        d.payments && d.payments.length > 0
          ? d.payments
          : [{ method: d.paymentMethod, amount: d.total, reference: null }];

      await tx.insert(paymentsTable).values(
        payments.map((p) => ({
          orderId: d.id,
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? null,
        })),
      );

      return { order, alreadyExisted: false as const };
    });

    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    req.log.error({ err, orderId: d.id }, "Failed to place order");
    res.status(500).json({ error: "Failed to save order" });
  }
});

// GET /api/orders -----------------------------------------------------------
router.get("/orders", requireAuth, async (req, res) => {
  const limit = Math.min(
    Number.parseInt(String(req.query.limit ?? "1000"), 10) || 1000,
    5000,
  );

  const orders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit);

  if (orders.length === 0) {
    res.json({ orders: [] });
    return;
  }

  // Fetch items + payments for these orders
  const ids = orders.map((o) => o.id);
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, ids));
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(inArray(paymentsTable.orderId, ids));

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

  res.json({
    orders: orders.map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
      payments: paymentsByOrder.get(o.id) ?? [],
    })),
  });
});

// PUBLIC invoice page (no auth) — this is what the receipt QR code points to.
// Customers scan the QR with their phone camera and land on a clean invoice
// view showing the bill amount, items, VAT, and seller info.
router.get("/public/invoice/:id", async (req, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    res.status(400).type("html").send("<h1>Invalid invoice id</h1>");
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (!order) {
    res
      .status(404)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Invoice not found</title>
         <body style="font-family:system-ui;text-align:center;padding:40px;color:#444">
         <h1 style="color:#0e5030">Invoice not found</h1>
         <p>The invoice <code>${escapeHtml(id)}</code> does not exist.</p>
         </body>`,
      );
    return;
  }

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, id));

  // Pull seller / restaurant info from settings if available
  const [settingsRow] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "settings"));
  type SellerSettings = {
    restaurantName?: string;
    restaurantNameAr?: string;
    vatNumber?: string;
    crNumber?: string;
    address?: string;
    addressAr?: string;
    phone?: string;
    currency?: string;
  };
  const settings: SellerSettings =
    (settingsRow?.value as SellerSettings | undefined) ?? {};

  const sellerName = settings.restaurantName || "Asrar Altahi Almomaiz";
  const sellerNameAr =
    settings.restaurantNameAr || "مطعم أسرار الطاحي المممعز";
  const vatNumber = settings.vatNumber || "";
  const crNumber = settings.crNumber || "";
  const phone = settings.phone || "";
  const address = settings.address || "";
  const addressAr = settings.addressAr || "";
  const currency = settings.currency || "SAR";

  const fmt = (v: string | number | null | undefined): string => {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const dateStr = createdAt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemsHtml = items
    .map(
      (it) => `
        <tr>
          <td style="padding:10px 6px;border-bottom:1px solid #eee">
            <div style="font-weight:600;color:#1a1a1a">${escapeHtml(it.name)}</div>
            ${it.nameAr ? `<div style="font-size:12px;color:#666;direction:rtl">${escapeHtml(it.nameAr)}</div>` : ""}
          </td>
          <td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:center;color:#444">${it.quantity}</td>
          <td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:right;color:#444">${fmt(it.unitPrice)}</td>
          <td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1a1a1a">${fmt(it.lineTotal)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invoice ${escapeHtml(order.id)} · ${escapeHtml(sellerName)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f4f4;color:#222;padding:16px}
    .card{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden}
    .head{background:linear-gradient(135deg,#0e5030 0%,#0a3d24 100%);color:#fff;padding:24px 20px;text-align:center}
    .head .brand{font-size:34px;font-weight:800;color:#d4af37;letter-spacing:.5px;line-height:1}
    .head .sub{font-size:14px;opacity:.92;margin-top:6px}
    .head .ar{font-size:14px;opacity:.92;margin-top:2px;direction:rtl}
    .meta{padding:16px 20px;background:#fafafa;border-bottom:1px solid #eee;font-size:13px;color:#555}
    .meta .row{display:flex;justify-content:space-between;margin:4px 0}
    .meta .row b{color:#1a1a1a}
    .body{padding:8px 20px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
    th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;padding:8px 6px;border-bottom:2px solid #0e5030}
    th.r{text-align:right}
    th.c{text-align:center}
    .totals{padding:12px 20px;border-top:2px dashed #ddd;font-size:14px}
    .totals .row{display:flex;justify-content:space-between;margin:6px 0;color:#444}
    .grand{font-size:22px;font-weight:800;color:#0e5030;border-top:2px solid #0e5030;padding-top:10px;margin-top:8px}
    .foot{padding:14px 20px 22px;text-align:center;color:#666;font-size:12px;background:#fafafa;border-top:1px solid #eee}
    .badge{display:inline-block;padding:4px 10px;background:#0e5030;color:#fff;border-radius:999px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;font-weight:700}
    .refunded{background:#a33}
    .thanks{font-size:16px;color:#0e5030;font-weight:700;margin-top:8px}
    .ar-thanks{direction:rtl;font-size:14px;margin-top:2px;color:#666}
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="brand">Asrar</div>
      <div class="sub">${escapeHtml(sellerName).replace("Asrar", "").replace("asrar", "").trim() || "Altahi Almomaiz Restaurant"}</div>
      <div class="ar">${escapeHtml(sellerNameAr)}</div>
    </div>

    <div class="meta">
      <div class="row"><span>Invoice</span><b>${escapeHtml(order.id)}</b></div>
      <div class="row"><span>Order #</span><b>${order.orderNumber}</b></div>
      <div class="row"><span>Date</span><b>${escapeHtml(dateStr)}</b></div>
      ${vatNumber ? `<div class="row"><span>VAT No.</span><b>${escapeHtml(vatNumber)}</b></div>` : ""}
      ${crNumber ? `<div class="row"><span>CR No.</span><b>${escapeHtml(crNumber)}</b></div>` : ""}
      ${address ? `<div class="row"><span>Address</span><b>${escapeHtml(address)}</b></div>` : ""}
      ${addressAr ? `<div class="row"><span>العنوان</span><b style="direction:rtl">${escapeHtml(addressAr)}</b></div>` : ""}
      ${phone ? `<div class="row"><span>Phone</span><b>${escapeHtml(phone)}</b></div>` : ""}
      <div class="row" style="margin-top:8px"><span>Status</span>
        <span class="badge ${order.status === "refunded" ? "refunded" : ""}">${escapeHtml(order.status)}</span>
      </div>
    </div>

    <div class="body">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="c">Qty</th>
            <th class="r">Price</th>
            <th class="r">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    <div class="totals">
      <div class="row"><span>Subtotal (excl. VAT)</span><span>${fmt(order.subtotal)} ${escapeHtml(currency)}</span></div>
      ${Number(order.discountAmount) > 0 ? `<div class="row"><span>Discount</span><span>-${fmt(order.discountAmount)} ${escapeHtml(currency)}</span></div>` : ""}
      <div class="row"><span>VAT (${(Number(order.vatRate) * 100).toFixed(0)}%)</span><span>${fmt(order.vatAmount)} ${escapeHtml(currency)}</span></div>
      <div class="row grand"><span>TOTAL</span><span>${fmt(order.total)} ${escapeHtml(currency)}</span></div>
      <div class="row" style="font-size:13px;color:#666;margin-top:6px"><span>Payment</span><span>${escapeHtml(order.paymentMethod)}</span></div>
    </div>

    <div class="foot">
      <div class="thanks">Thank you for visiting!</div>
      <div class="ar-thanks">شكراً لزيارتكم</div>
    </div>
  </div>
</body>
</html>`;

  res
    .status(200)
    .type("html")
    .setHeader("Cache-Control", "public, max-age=300")
    .send(html);
});

router.get("/orders/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id)) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, id));
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.orderId, id));
  res.json({ order: { ...order, items, payments } });
});

export default router;
