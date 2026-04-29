import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ----- Categories -----
export const categoriesTable = pgTable(
  "categories",
  {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("IDX_categories_sort").on(table.sortOrder)],
);

// ----- Menu items (prices stored INCLUSIVE of VAT, matching frontend) -----
export const menuItemsTable = pgTable(
  "menu_items",
  {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    categoryId: varchar("category_id").references(() => categoriesTable.id, {
      onDelete: "set null",
    }),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    image: text("image"),
    description: text("description"),
    available: boolean("available").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("IDX_menu_category").on(table.categoryId),
    index("IDX_menu_available").on(table.available),
  ],
);

// ----- Customers -----
export const customersTable = pgTable(
  "customers",
  {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    phone: varchar("phone"),
    email: varchar("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("IDX_customer_phone").on(table.phone)],
);

// ----- Orders (one row per receipt) -----
// All money fields use precision 12, scale 2.
// VAT-INCLUSIVE pricing model:
//   gross    = sum(line item price * qty) [incl. VAT]
//   total    = gross - discountAmount [incl. VAT]
//   subtotal = total / (1 + vatRate)    [excl. VAT]
//   vat      = total - subtotal
export const ordersTable = pgTable(
  "orders",
  {
    id: varchar("id").primaryKey(), // matches frontend's display order id (e.g. "ORD-1042")
    orderNumber: integer("order_number").notNull(),
    status: varchar("status").notNull().default("completed"), // completed | refunded | held
    paymentMethod: varchar("payment_method").notNull(), // cash | card | mada | apple_pay | stc_pay | other
    cashier: varchar("cashier"), // username from local cashier login (admin/cashier1/etc)

    customerId: varchar("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name"),

    // money
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull(), // sum of line items, incl VAT
    discountType: varchar("discount_type"), // percent | fixed | null
    discountValue: numeric("discount_value", {
      precision: 12,
      scale: 2,
    }).default("0"),
    discountAmount: numeric("discount_amount", {
      precision: 12,
      scale: 2,
    }).notNull().default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(), // grand total incl VAT
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(), // excl VAT
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 6, scale: 4 }).notNull(), // e.g. 0.1500

    // raw extras
    notes: text("notes"),
    extras: jsonb("extras"), // for any future extension fields

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_orders_created_at").on(table.createdAt),
    index("IDX_orders_status").on(table.status),
    index("IDX_orders_customer").on(table.customerId),
    index("IDX_orders_payment_method").on(table.paymentMethod),
  ],
);

// ----- Order items -----
export const orderItemsTable = pgTable(
  "order_items",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: varchar("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    menuItemId: varchar("menu_item_id"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(), // incl VAT
    quantity: integer("quantity").notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(), // unit_price * quantity, incl VAT
  },
  (table) => [index("IDX_order_items_order").on(table.orderId)],
);

// ----- Payments (one row per payment; today always 1 per order, but
// modeled separately so we can support split-tender later) -----
export const paymentsTable = pgTable(
  "payments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: varchar("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    method: varchar("method").notNull(), // cash | card | mada | apple_pay | stc_pay | other
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reference: varchar("reference"), // e.g. card last 4 / txn id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_payments_order").on(table.orderId),
    index("IDX_payments_method").on(table.method),
  ],
);

// ----- Settings KV (single-row blobs from the frontend, e.g. settings, sequence,
// staff users for the cashier login layer) -----
export const settingsTable = pgTable("settings_kv", {
  key: varchar("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ----- Tickets / Tokens (queue numbering, e.g. T-001, T-002) -----
// Counter resets daily (auto at midnight server local time) or on manual
// admin reset. The "number" column stores the per-day sequence (1, 2, 3...);
// the "label" column stores the formatted display value (T-001).
export const ticketsTable = pgTable(
  "tickets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    number: integer("number").notNull(),
    label: varchar("label").notNull(),
    counterName: varchar("counter_name"),
    cashier: varchar("cashier"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_tickets_created_at").on(table.createdAt),
    index("IDX_tickets_number").on(table.number),
  ],
);

// ----- Inferred types -----
export type Category = typeof categoriesTable.$inferSelect;
export type InsertCategory = typeof categoriesTable.$inferInsert;
export type MenuItem = typeof menuItemsTable.$inferSelect;
export type InsertMenuItem = typeof menuItemsTable.$inferInsert;
export type Customer = typeof customersTable.$inferSelect;
export type InsertCustomer = typeof customersTable.$inferInsert;
export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = typeof ordersTable.$inferInsert;
export type OrderItem = typeof orderItemsTable.$inferSelect;
export type InsertOrderItem = typeof orderItemsTable.$inferInsert;
export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
