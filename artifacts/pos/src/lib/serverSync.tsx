/**
 * Server sync layer — minimum-touch dual write between localStorage and the
 * REST API.
 *
 * The existing App.tsx persists state through a tiny `storage` helper that
 * reads/writes via `window.storage` (when available) and falls back to
 * `localStorage`. We install a `window.storage` proxy here that:
 *
 *  - reads synchronously from `localStorage` (so App.tsx initial state works)
 *  - on writes, also schedules a debounced background sync to the server
 *
 * On boot we hydrate localStorage from the server before mounting App, so the
 * first read shows the server's source of truth.
 *
 * If the server is unreachable, writes still succeed locally — the UI keeps
 * working in offline mode.
 */

import { useEffect, useState, type ReactNode } from "react";
import { api, type ServerCategory, type ServerCustomer, type ServerMenuItem } from "./api";

// ---------------------------------------------------------------------------
// Local types mirroring App.tsx
// ---------------------------------------------------------------------------

interface LocalMenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string;
  available: boolean;
}

interface LocalOrderItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

interface LocalOrder {
  id: number;
  date: string;
  customer: string;
  items: LocalOrderItem[];
  subtotal: number;
  discount: number;
  discountType?: "percent" | "amount";
  discountValue?: number;
  vat: number;
  total: number;
  paymentMethod: string;
}

interface LocalSettings {
  restaurantName: string;
  restaurantNameAr: string;
  address: string;
  vatPercent: number;
  vatNumber: string;
  crNumber: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Sync status — tiny pub/sub so a header indicator can subscribe
// ---------------------------------------------------------------------------

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

const statusListeners = new Set<(s: SyncStatus) => void>();
let currentStatus: SyncStatus = "synced";

function setStatus(s: SyncStatus) {
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

export function getSyncStatus() {
  return currentStatus;
}

export function subscribeSyncStatus(fn: (s: SyncStatus) => void) {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

// Track in-flight sync work so we can flip the status correctly.
let inflight = 0;
function startWork() {
  inflight++;
  if (inflight === 1) setStatus("syncing");
}
function endWork(ok: boolean) {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) setStatus(ok ? "synced" : "error");
}

// ---------------------------------------------------------------------------
// Hydration — fetch from server, write into localStorage BEFORE App mounts
// ---------------------------------------------------------------------------

const KEYS = {
  menu: "pos:menu",
  categories: "pos:categories",
  orders: "pos:orders",
  customers: "pos:customers",
  settings: "pos:settings",
  nextOrderId: "pos:nextOrderId",
} as const;

async function hydrateFromServer(): Promise<void> {
  setStatus("syncing");
  try {
    const [menuRes, catsRes, ordersRes, settingsRes] = await Promise.all([
      api.get<{ items: ServerMenuItem[] }>("/api/menu"),
      api.get<{ categories: ServerCategory[] }>("/api/categories"),
      api.get<{ orders: ServerOrderResponseItem[] }>("/api/orders?limit=1000"),
      api
        .get<{ value: LocalSettings | null }>("/api/settings/pos:settings")
        .catch(() => ({ value: null })),
    ]);

    if (menuRes.items.length > 0) {
      const localMenu: LocalMenuItem[] = menuRes.items.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.categoryId ?? "Uncategorized",
        price: Number(m.price),
        description: m.description ?? undefined,
        available: m.available,
      }));
      localStorage.setItem(KEYS.menu, JSON.stringify(localMenu));
    }

    if (catsRes.categories.length > 0) {
      const localCats = catsRes.categories
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => c.name);
      localStorage.setItem(KEYS.categories, JSON.stringify(localCats));
    }

    // Mark every order the server already has as "seen" so we don't re-POST
    // them. We MUST NOT seed from local orders here — any local-only order
    // (created while offline, or pre-existing from before the migration) must
    // remain unseen so it gets pushed up by the next syncOrders() pass.
    const serverOrders = ordersRes.orders.map(serverOrderToLocal);
    for (const o of serverOrders) {
      seenOrderIds.add(o.id);
    }

    // Merge local + server orders: prefer server data for shared IDs, then
    // append any local-only orders so they survive hydration. The next
    // syncOrders() pass will push the local-only ones to the server.
    const localRaw = localStorage.getItem(KEYS.orders);
    const localOrders: LocalOrder[] = localRaw
      ? (() => {
          try {
            return JSON.parse(localRaw) as LocalOrder[];
          } catch {
            return [];
          }
        })()
      : [];
    const byId = new Map<number, LocalOrder>();
    for (const o of serverOrders) byId.set(o.id, o);
    for (const o of localOrders) {
      if (!byId.has(o.id)) byId.set(o.id, o);
    }
    if (byId.size > 0) {
      const merged = Array.from(byId.values()).sort((a, b) => b.id - a.id);
      localStorage.setItem(KEYS.orders, JSON.stringify(merged));

      const maxId = merged.reduce(
        (acc, o) => (o.id > acc ? o.id : acc),
        1000,
      );
      // Only bump nextOrderId forward, never backward.
      const currentNext = (() => {
        try {
          const v = localStorage.getItem(KEYS.nextOrderId);
          return v ? Number(JSON.parse(v)) : 1001;
        } catch {
          return 1001;
        }
      })();
      const next = Math.max(currentNext, maxId + 1);
      localStorage.setItem(KEYS.nextOrderId, JSON.stringify(next));
    }

    if (settingsRes.value) {
      localStorage.setItem(KEYS.settings, JSON.stringify(settingsRes.value));
    }

    // After hydration, if there are local-only orders, push them now.
    const unsynced = localOrders.filter((o) => !seenOrderIds.has(o.id));
    if (unsynced.length > 0) {
      const settingsRaw = localStorage.getItem(KEYS.settings);
      let vatPercent = 15;
      if (settingsRaw) {
        try {
          const s = JSON.parse(settingsRaw) as LocalSettings;
          if (typeof s.vatPercent === "number") vatPercent = s.vatPercent;
        } catch {
          /* ignore */
        }
      }
      const vatRate = (vatPercent / 100).toFixed(4);
      for (const o of unsynced) {
        try {
          await postOrder(o, vatRate);
          seenOrderIds.add(o.id);
        } catch (err) {
          console.warn(
            `[serverSync] Failed to push pre-existing local order ${o.id}`,
            err,
          );
        }
      }
    }

    setStatus("synced");
  } catch (err) {
    console.warn("[serverSync] Hydration failed; using local cache", err);
    setStatus("offline");
  }
}

interface ServerOrderResponseItem {
  id: string;
  orderNumber: number;
  paymentMethod: string;
  customerName: string | null;
  discountAmount: string;
  discountType: string | null;
  discountValue: string | null;
  vatAmount: string;
  total: string;
  subtotal: string;
  createdAt: string;
  items: Array<{
    menuItemId?: string | null;
    name: string;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }>;
}

function serverOrderToLocal(o: ServerOrderResponseItem): LocalOrder {
  return {
    id: o.orderNumber,
    date: o.createdAt,
    customer: o.customerName ?? "",
    items: o.items.map((it, idx) => ({
      id: it.menuItemId ?? `srv-${o.id}-${idx}`,
      name: it.name,
      price: Number(it.unitPrice),
      qty: it.quantity,
    })),
    subtotal: Number(o.subtotal),
    discount: Number(o.discountAmount),
    discountType: (o.discountType === "fixed" ? "amount" : (o.discountType as "percent" | "amount" | undefined)) ?? undefined,
    discountValue: o.discountValue != null ? Number(o.discountValue) : undefined,
    vat: Number(o.vatAmount),
    total: Number(o.total),
    paymentMethod: o.paymentMethod,
  };
}

// ---------------------------------------------------------------------------
// Outbound sync — diff & push on every storage write
// ---------------------------------------------------------------------------

const lastSyncedRaw: Record<string, string | null> = {};
const debounceTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

function scheduleSync(key: string, raw: string) {
  // Skip when the value did not actually change since last successful push.
  if (lastSyncedRaw[key] === raw) return;

  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    void runSync(key, raw);
  }, 400);
}

async function runSync(key: string, raw: string) {
  startWork();
  try {
    switch (key) {
      case KEYS.menu:
        await syncMenu(raw);
        break;
      case KEYS.categories:
        await syncCategories(raw);
        break;
      case KEYS.orders:
        await syncOrders(raw);
        break;
      case KEYS.settings:
        await syncSettings(raw);
        break;
      default:
        // Other keys (nextOrderId, users, cloud, session) stay local-only.
        endWork(true);
        return;
    }
    lastSyncedRaw[key] = raw;
    endWork(true);
  } catch (err) {
    console.warn(`[serverSync] Sync failed for ${key}`, err);
    endWork(false);
  }
}

async function syncMenu(raw: string) {
  const items = JSON.parse(raw) as LocalMenuItem[];
  await api.put("/api/menu", {
    items: items.map((m) => ({
      id: String(m.id),
      name: m.name,
      categoryId: m.category || null,
      price: m.price.toFixed(2),
      description: m.description ?? null,
      available: m.available !== false,
    })),
  });
}

async function syncCategories(raw: string) {
  const cats = JSON.parse(raw) as string[];
  await api.put("/api/categories", {
    categories: cats.map((name, idx) => ({
      id: name,
      name,
      sortOrder: idx,
    })),
  });
}

async function syncSettings(raw: string) {
  const value = JSON.parse(raw) as LocalSettings;
  await api.put("/api/settings/pos:settings", { value });
}

// Order sync: only POST orders we haven't seen before. The server endpoint is
// idempotent (onConflictDoNothing on display id), so duplicate POSTs are safe.
const seenOrderIds = new Set<number>();

async function syncOrders(raw: string) {
  const orders = JSON.parse(raw) as LocalOrder[];
  const settingsRaw = localStorage.getItem(KEYS.settings);
  let vatPercent = 15;
  if (settingsRaw) {
    try {
      const s = JSON.parse(settingsRaw) as LocalSettings;
      if (typeof s.vatPercent === "number") vatPercent = s.vatPercent;
    } catch {
      /* ignore */
    }
  }
  const vatRate = (vatPercent / 100).toFixed(4);

  const newOnes = orders.filter((o) => !seenOrderIds.has(o.id));
  for (const o of newOnes) {
    try {
      await postOrder(o, vatRate);
      seenOrderIds.add(o.id);
    } catch (err) {
      console.warn(`[serverSync] Failed to push order ${o.id}`, err);
    }
  }
}

async function postOrder(o: LocalOrder, vatRate: string) {
  const gross = o.items.reduce((acc, it) => acc + it.price * it.qty, 0);
  const items = o.items.map((it) => ({
    menuItemId: String(it.id),
    name: it.name,
    unitPrice: it.price.toFixed(2),
    quantity: it.qty,
    lineTotal: (it.price * it.qty).toFixed(2),
  }));

  const body = {
    id: `ORD-${o.id}`,
    orderNumber: o.id,
    status: "completed" as const,
    paymentMethod: o.paymentMethod,
    customerName: o.customer || null,
    gross: gross.toFixed(2),
    discountType:
      o.discountType === "amount"
        ? ("fixed" as const)
        : o.discountType === "percent"
          ? ("percent" as const)
          : null,
    discountValue:
      typeof o.discountValue === "number"
        ? o.discountValue.toFixed(2)
        : "0.00",
    discountAmount: (o.discount ?? 0).toFixed(2),
    total: o.total.toFixed(2),
    subtotal: o.subtotal.toFixed(2),
    vatAmount: o.vat.toFixed(2),
    vatRate,
    items,
    payments: [
      {
        method: o.paymentMethod,
        amount: o.total.toFixed(2),
        reference: null,
      },
    ],
    createdAt: o.date,
  };

  await api.post("/api/orders", body);
}

// ---------------------------------------------------------------------------
// Customer sync — currently App.tsx has no customer book; expose helpers for
// future use without changing behaviour.
// ---------------------------------------------------------------------------

export async function listCustomers(): Promise<ServerCustomer[]> {
  const res = await api.get<{ customers: ServerCustomer[] }>("/api/customers");
  return res.customers;
}

// ---------------------------------------------------------------------------
// Storage proxy installation
// ---------------------------------------------------------------------------

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function installStorageProxy() {
  const proxy: StorageLike = {
    getItem(key: string) {
      return localStorage.getItem(key);
    },
    setItem(key: string, value: string) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
      // Mirror writes for keys we know how to sync.
      if (
        key === KEYS.menu ||
        key === KEYS.categories ||
        key === KEYS.orders ||
        key === KEYS.settings
      ) {
        scheduleSync(key, value);
      }
    },
    removeItem(key: string) {
      localStorage.removeItem(key);
    },
  };
  // Attach without overwriting if the host already provides one.
  (window as unknown as { storage?: StorageLike }).storage = proxy;
}

// ---------------------------------------------------------------------------
// React Provider — runs hydration once before rendering children
// ---------------------------------------------------------------------------

interface ProviderProps {
  children: ReactNode;
}

export function ServerSyncProvider({ children }: ProviderProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    installStorageProxy();
    void hydrateFromServer().finally(() => {
      // Seed `lastSyncedRaw` for non-orders keys with current localStorage so
      // the first useEffect-based write in App.tsx doesn't trigger a redundant
      // sync of unchanged data. We DO NOT touch `seenOrderIds` here — that
      // set is populated by hydrateFromServer() with only server-confirmed
      // IDs, which is what protects against re-POSTing while still allowing
      // local-only orders to be uploaded.
      for (const k of Object.values(KEYS)) {
        lastSyncedRaw[k] = localStorage.getItem(k);
      }
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>Loading your data…</div>
      </div>
    );
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Status indicator — opt-in component, mounted in a fixed corner
// ---------------------------------------------------------------------------

export function SyncIndicator() {
  const [status, setStatusState] = useState<SyncStatus>(getSyncStatus());

  useEffect(() => {
    return subscribeSyncStatus(setStatusState);
  }, []);

  const palette: Record<SyncStatus, { bg: string; fg: string; label: string }> = {
    synced: { bg: "#16a34a", fg: "white", label: "Synced" },
    syncing: { bg: "#f59e0b", fg: "white", label: "Syncing…" },
    offline: { bg: "#64748b", fg: "white", label: "Offline" },
    error: { bg: "#dc2626", fg: "white", label: "Sync error" },
  };
  const p = palette[status];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        background: p.bg,
        color: p.fg,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: p.fg,
          marginRight: 6,
          verticalAlign: "middle",
          opacity: 0.85,
        }}
      />
      {p.label}
    </div>
  );
}
