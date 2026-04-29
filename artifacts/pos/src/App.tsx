import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import logoUrl from "@assets/WhatsApp_Image_2026-04-23_at_11.05.44_PM_1777135297272.jpeg";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";

type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string;
  available: boolean;
};

// Raw materials / inventory ingredients (separate from menu items).
// Used to track stock of supplies like rice, chicken, oil, etc.
type RawMaterial = {
  id: string;
  name: string;
  unit: string; // e.g. "kg", "g", "L", "ml", "pcs", "pack"
  stock: number;
  lowStockThreshold: number;
  costPerUnit?: number;
  notes?: string;
};

type CartItem = { id: string; name: string; price: number; qty: number };

type Order = {
  id: number;
  date: string;
  customer: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  discountType?: "percent" | "amount";
  discountValue?: number;
  vat: number;
  total: number;
  paymentMethod: PaymentMethod;
};

type PaymentMethod = "Cash" | "Card" | "Mada" | "Apple Pay" | "STC Pay";

const PAYMENT_METHODS: PaymentMethod[] = [
  "Cash",
  "Card",
  "Mada",
  "Apple Pay",
  "STC Pay",
];

type Settings = {
  restaurantName: string;
  restaurantNameAr: string;
  address: string;
  vatPercent: number;
  vatNumber: string;
  crNumber: string;
  currency: string;
};

const DEFAULT_CATEGORIES = ["Biryani", "Roti/Bread", "Drinks", "Extras"];

const DEFAULT_MENU: MenuItem[] = [
  { id: "1", name: "Chicken Biryani", category: "Biryani", price: 18, available: true },
  { id: "2", name: "Beef Biryani", category: "Biryani", price: 22, available: true },
  { id: "3", name: "Mutton Biryani", category: "Biryani", price: 25, available: true },
  { id: "4", name: "Roti", category: "Roti/Bread", price: 2, available: true },
  { id: "5", name: "Butter Naan", category: "Roti/Bread", price: 3, available: true },
  { id: "6", name: "Chicken Masala", category: "Extras", price: 20, available: true },
  { id: "7", name: "Chai", category: "Drinks", price: 3, available: true },
  { id: "8", name: "Cold Drink", category: "Drinks", price: 5, available: true },
  { id: "9", name: "Water Bottle", category: "Drinks", price: 2, available: true },
];

const DEFAULT_RAW_MATERIALS: RawMaterial[] = [
  { id: "rm1", name: "Basmati Rice", unit: "kg", stock: 50, lowStockThreshold: 10, costPerUnit: 8 },
  { id: "rm2", name: "Chicken (Whole)", unit: "kg", stock: 20, lowStockThreshold: 5, costPerUnit: 18 },
  { id: "rm3", name: "Mutton", unit: "kg", stock: 8, lowStockThreshold: 5, costPerUnit: 55 },
  { id: "rm4", name: "Beef", unit: "kg", stock: 12, lowStockThreshold: 5, costPerUnit: 40 },
  { id: "rm5", name: "Cooking Oil", unit: "L", stock: 15, lowStockThreshold: 5, costPerUnit: 12 },
  { id: "rm6", name: "Wheat Flour", unit: "kg", stock: 25, lowStockThreshold: 10, costPerUnit: 4 },
  { id: "rm7", name: "Onion", unit: "kg", stock: 10, lowStockThreshold: 3, costPerUnit: 3 },
  { id: "rm8", name: "Tomato", unit: "kg", stock: 8, lowStockThreshold: 3, costPerUnit: 5 },
  { id: "rm9", name: "Yogurt", unit: "kg", stock: 5, lowStockThreshold: 2, costPerUnit: 8 },
  { id: "rm10", name: "Spice Mix", unit: "pack", stock: 12, lowStockThreshold: 4, costPerUnit: 15 },
  { id: "rm11", name: "Tea Leaves", unit: "kg", stock: 3, lowStockThreshold: 1, costPerUnit: 30 },
  { id: "rm12", name: "Cold Drink Bottles", unit: "pcs", stock: 60, lowStockThreshold: 20, costPerUnit: 2 },
  { id: "rm13", name: "Water Bottles", unit: "pcs", stock: 100, lowStockThreshold: 30, costPerUnit: 1 },
];

const DEFAULT_SETTINGS: Settings = {
  restaurantName: "Asrar Altahi Almomaiz Restaurant",
  restaurantNameAr: "مطعم أسرار الطاحي الممعز",
  address: "Riyadh, Saudi Arabia",
  vatPercent: 15,
  vatNumber: "310433555500003",
  crNumber: "",
  currency: "SAR",
};

// window.storage wrapper (falls back to localStorage)
const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const w: any = window;
      const raw = w.storage?.getItem
        ? w.storage.getItem(key)
        : localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      const w: any = window;
      const str = JSON.stringify(value);
      if (w.storage?.setItem) w.storage.setItem(key, str);
      else localStorage.setItem(key, str);
    } catch {
      /* ignore */
    }
  },
};

const fmt = (n: number, currency = "SAR") => `${currency} ${n.toFixed(2)}`;

// Build a ZATCA-compliant Phase 1 QR code (TLV encoded as Base64).
// Tags: 1=Seller name, 2=VAT reg number, 3=Timestamp (ISO8601),
//       4=Invoice total (with VAT), 5=VAT total. All values UTF-8.
function buildZatcaQR(p: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  total: number;
  vat: number;
}): string {
  const enc = new TextEncoder();
  const fields: [number, string][] = [
    [1, p.sellerName || ""],
    [2, p.vatNumber || ""],
    [3, p.timestamp],
    [4, p.total.toFixed(2)],
    [5, p.vat.toFixed(2)],
  ];
  const parts: number[] = [];
  for (const [tag, val] of fields) {
    const bytes = enc.encode(val);
    parts.push(tag, bytes.length, ...bytes);
  }
  let bin = "";
  for (const b of parts) bin += String.fromCharCode(b);
  return btoa(bin);
}

type Role = "admin" | "cashier";

type User = {
  username: string;
  password: string;
  role: Role;
  displayName?: string;
};

type Session = {
  username: string;
  role: Role;
  displayName?: string;
  expiresAt: number; // ms epoch
};

type CloudStatus = "synced" | "offline" | "syncing" | "error" | "disabled";

type FirebaseConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

type CloudSettings = {
  enabled: boolean;
  config: FirebaseConfig;
  collection: string;
  lastBackupAt: number | null;
};

const DEFAULT_USERS: User[] = [
  {
    username: "admin",
    password: "admin",
    role: "admin",
    displayName: "Administrator",
  },
  {
    username: "cashier1",
    password: "1234",
    role: "cashier",
    displayName: "Cashier 1",
  },
];

const DEFAULT_CLOUD: CloudSettings = {
  enabled: false,
  config: {},
  collection: "albarakah_pos",
  lastBackupAt: null,
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

type View =
  | "billing"
  | "tickets"
  | "menu"
  | "inventory"
  | "history"
  | "summary"
  | "reports"
  | "settings";

export default function App() {
  const [view, setView] = useState<View>("billing");
  const [menu, setMenu] = useState<MenuItem[]>(() =>
    storage.get<MenuItem[]>("pos:menu", DEFAULT_MENU),
  );
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>(() =>
    storage.get<RawMaterial[]>("pos:rawMaterials", DEFAULT_RAW_MATERIALS),
  );
  const [categories, setCategories] = useState<string[]>(() =>
    storage.get<string[]>("pos:categories", DEFAULT_CATEGORIES),
  );
  const [orders, setOrders] = useState<Order[]>(() =>
    storage.get<Order[]>("pos:orders", []),
  );
  const [settings, setSettings] = useState<Settings>(() =>
    storage.get<Settings>("pos:settings", DEFAULT_SETTINGS),
  );
  const [nextOrderId, setNextOrderId] = useState<number>(() =>
    storage.get<number>("pos:nextOrderId", 1001),
  );
  const [users, setUsers] = useState<User[]>(() =>
    storage.get<User[]>("pos:users", DEFAULT_USERS),
  );
  const [cloud, setCloud] = useState<CloudSettings>(() =>
    storage.get<CloudSettings>("pos:cloud", DEFAULT_CLOUD),
  );
  const [session, setSession] = useState<Session | null>(() => {
    const s = storage.get<Session | null>("pos:session", null);
    if (s && s.expiresAt > Date.now()) return s;
    return null;
  });
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("disabled");
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    "percent",
  );
  const [discountValue, setDiscountValue] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => storage.set("pos:menu", menu), [menu]);
  useEffect(() => storage.set("pos:rawMaterials", rawMaterials), [rawMaterials]);
  useEffect(() => storage.set("pos:categories", categories), [categories]);
  useEffect(() => storage.set("pos:orders", orders), [orders]);
  useEffect(() => storage.set("pos:settings", settings), [settings]);
  useEffect(() => storage.set("pos:nextOrderId", nextOrderId), [nextOrderId]);
  useEffect(() => storage.set("pos:users", users), [users]);
  useEffect(() => storage.set("pos:cloud", cloud), [cloud]);
  useEffect(() => {
    if (session) storage.set("pos:session", session);
    else storage.set("pos:session", null);
  }, [session]);

  // Online/offline listener
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Session expiry watcher
  useEffect(() => {
    if (!session) return;
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      setSession(null);
      return;
    }
    const t = setTimeout(() => setSession(null), remaining);
    return () => clearTimeout(t);
  }, [session]);

  // Reconcile active session with users list (revoke immediately when admin
  // edits, deletes, or changes the role/displayName of the logged-in account)
  useEffect(() => {
    if (!session) return;
    const u = users.find(
      (x) => x.username.toLowerCase() === session.username.toLowerCase(),
    );
    if (!u) {
      setSession(null);
      setView("billing");
      return;
    }
    if (u.role !== session.role || u.displayName !== session.displayName) {
      setSession({ ...session, role: u.role, displayName: u.displayName });
      if (u.role !== "admin") setView("billing");
    }
  }, [users, session]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Firebase singleton refs
  const fbAppRef = useRef<any>(null);
  const fbDbRef = useRef<any>(null);
  const fbConfigKeyRef = useRef<string>("");

  // (Re)initialize Firebase when config changes
  useEffect(() => {
    const cfg = cloud.config;
    const key = JSON.stringify(cfg);
    if (!cloud.enabled || !cfg.apiKey || !cfg.projectId) {
      fbAppRef.current = null;
      fbDbRef.current = null;
      fbConfigKeyRef.current = "";
      setCloudStatus("disabled");
      return;
    }
    if (key === fbConfigKeyRef.current && fbDbRef.current) return;
    setCloudStatus("syncing");
    (async () => {
      try {
        const { initializeApp, getApps, deleteApp } = await import(
          "firebase/app"
        );
        const { getFirestore } = await import("firebase/firestore");
        // Clean up any prior app
        for (const a of getApps()) {
          try {
            await deleteApp(a);
          } catch {}
        }
        const app = initializeApp(cfg as any);
        const db = getFirestore(app);
        fbAppRef.current = app;
        fbDbRef.current = db;
        fbConfigKeyRef.current = key;
        setCloudStatus(online ? "synced" : "offline");
      } catch (e) {
        console.error("Firebase init failed", e);
        setCloudStatus("error");
      }
    })();
  }, [cloud.enabled, cloud.config, online]);

  // Sync helper: writes a doc to firestore. Returns true on success.
  const cloudSync = useCallback(
    async (
      kind: "order" | "menu" | "settings" | "users" | "snapshot",
      id: string,
      data: any,
    ): Promise<boolean> => {
      const db = fbDbRef.current;
      if (!cloud.enabled || !db) return false;
      if (!online) {
        setCloudStatus("offline");
        return false;
      }
      try {
        setCloudStatus("syncing");
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(
          doc(db, cloud.collection, `${kind}_${id}`),
          {
            ...data,
            _kind: kind,
            _id: id,
            _updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        setCloudStatus("synced");
        setCloud((c) => ({ ...c, lastBackupAt: Date.now() }));
        return true;
      } catch (e) {
        console.error("Cloud sync failed", e);
        setCloudStatus("error");
        return false;
      }
    },
    [cloud.enabled, cloud.collection, online],
  );

  // VAT-INCLUSIVE pricing: menu prices already include VAT.
  // gross = customer-facing total before discount
  // total = final paid amount = gross − discount
  // subtotal = ex-VAT base (taxable), vat = VAT extracted from total
  const gross = useMemo(
    () => cart.reduce((s, c) => s + c.price * c.qty, 0),
    [cart],
  );
  const dvNum = parseFloat(discountValue) || 0;
  const rawDiscount =
    discountType === "percent" ? gross * (dvNum / 100) : dvNum;
  const discount = +Math.max(0, Math.min(rawDiscount, gross)).toFixed(2);
  const total = +(gross - discount).toFixed(2);
  const vatRate = settings.vatPercent / 100;
  const subtotal = +(total / (1 + vatRate)).toFixed(2);
  const vat = +(total - subtotal).toFixed(2);

  const addToCart = (item: MenuItem) => {
    if (!item.available) return;
    setCart((c) => {
      const found = c.find((x) => x.id === item.id);
      if (found)
        return c.map((x) =>
          x.id === item.id ? { ...x, qty: x.qty + 1 } : x,
        );
      return [...c, { id: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((c) =>
      c
        .map((x) => (x.id === id ? { ...x, qty: x.qty + delta } : x))
        .filter((x) => x.qty > 0),
    );
  };

  const removeFromCart = (id: string) =>
    setCart((c) => c.filter((x) => x.id !== id));

  const placeOrder = () => {
    if (cart.length === 0) return;
    const order: Order = {
      id: nextOrderId,
      date: new Date().toISOString(),
      customer: customer.trim() || "Walk-in",
      items: [...cart],
      subtotal,
      discount,
      discountType: discount > 0 ? discountType : undefined,
      discountValue: discount > 0 ? dvNum : undefined,
      vat,
      total,
      paymentMethod,
    };
    setOrders((o) => [order, ...o]);
    setNextOrderId((n) => n + 1);
    setReceiptOrder(order);
    setCart([]);
    setCustomer("");
    setDiscountValue("");
    setPaymentMethod("Cash");
    // Auto-sync to cloud (fire and forget)
    cloudSync("order", String(order.id), order);
  };

  // Login / logout
  const login = (username: string, password: string): string | null => {
    const u = username.trim().toLowerCase();
    const found = users.find(
      (x) => x.username.toLowerCase() === u && x.password === password,
    );
    if (!found) return "Invalid username or password";
    setSession({
      username: found.username,
      role: found.role,
      displayName: found.displayName,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    setView(found.role === "cashier" ? "billing" : "billing");
    return null;
  };
  const logout = () => {
    setSession(null);
    setView("billing");
  };

  // Backup helpers
  const backupNow = useCallback(async () => {
    const snapshot = {
      menu,
      categories,
      orders,
      settings,
      users,
      nextOrderId,
      exportedAt: new Date().toISOString(),
    };
    if (cloud.enabled && fbDbRef.current && online) {
      const ok = await cloudSync("snapshot", "latest", snapshot);
      if (ok) return "Cloud backup complete";
      return "Cloud backup failed (check console)";
    }
    return "Cloud not configured — use Export JSON instead";
  }, [
    menu,
    categories,
    orders,
    settings,
    users,
    nextOrderId,
    cloud.enabled,
    cloudSync,
    online,
  ]);

  const exportJSON = () => {
    const snapshot = {
      menu,
      categories,
      orders,
      settings,
      users,
      nextOrderId,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const restoreJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(String(e.target?.result || "{}"));
        if (!confirm("Restore will overwrite all current data. Continue?"))
          return;
        if (Array.isArray(data.menu)) setMenu(data.menu);
        if (Array.isArray(data.categories)) setCategories(data.categories);
        if (Array.isArray(data.orders)) setOrders(data.orders);
        if (data.settings) setSettings(data.settings);
        if (Array.isArray(data.users) && data.users.length > 0)
          setUsers(data.users);
        if (typeof data.nextOrderId === "number")
          setNextOrderId(data.nextOrderId);
        alert("Restore complete.");
      } catch (err) {
        alert("Invalid backup file: " + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    storage.get<boolean>("pos:sidebarCollapsed", false),
  );
  useEffect(() => {
    storage.set("pos:sidebarCollapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);
  const handleSetView = (v: View) => {
    setView(v);
    setSidebarOpen(false);
  };

  // Gate: must be logged in
  if (!session) {
    return (
      <LoginScreen settings={settings} onLogin={login} />
    );
  }

  // Cashiers can only access billing
  const role: Role = session.role;
  const allowedViews: View[] =
    role === "admin"
      ? ["billing", "menu", "tickets", "inventory", "history", "summary", "reports", "settings"]
      : ["billing", "tickets"];
  const effectiveView: View = allowedViews.includes(view) ? view : "billing";

  // Effective cloud status (folds in offline)
  const effStatus: CloudStatus = !cloud.enabled
    ? "disabled"
    : !online
      ? "offline"
      : cloudStatus;

  return (
    <div
      className="flex relative"
      style={{ backgroundColor: "#f5f5f0", height: "100dvh", maxHeight: "100dvh" }}
    >
      <Sidebar
        view={effectiveView}
        setView={handleSetView}
        settings={settings}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        role={role}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative" style={{ zIndex: 2 }}>
        <Header
          now={now}
          settings={settings}
          onMenuClick={() => setSidebarOpen((o) => !o)}
          session={session}
          onLogout={logout}
          cloudStatus={effStatus}
        />
        <div className="flex-1 overflow-hidden">
          {effectiveView === "billing" && (
            <Billing
              menu={menu}
              categories={categories}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              cart={cart}
              addToCart={addToCart}
              changeQty={changeQty}
              removeFromCart={removeFromCart}
              customer={customer}
              setCustomer={setCustomer}
              discountType={discountType}
              setDiscountType={setDiscountType}
              discountValue={discountValue}
              setDiscountValue={setDiscountValue}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              gross={gross}
              subtotal={subtotal}
              discount={discount}
              vat={vat}
              total={total}
              settings={settings}
              placeOrder={placeOrder}
            />
          )}
          {effectiveView === "menu" && (
            <MenuEditor
              menu={menu}
              setMenu={setMenu}
              categories={categories}
              setCategories={setCategories}
              settings={settings}
            />
          )}
          {effectiveView === "tickets" && (
            <TicketsView
              settings={settings}
              session={session}
            />
          )}
          {effectiveView === "inventory" && (
            <Inventory
              rawMaterials={rawMaterials}
              setRawMaterials={setRawMaterials}
              settings={settings}
            />
          )}
          {effectiveView === "history" && (
            <History
              orders={orders}
              settings={settings}
              onReprint={(o) => setReceiptOrder(o)}
            />
          )}
          {effectiveView === "summary" && (
            <Summary orders={orders} settings={settings} />
          )}
          {effectiveView === "reports" && (
            <Reports orders={orders} settings={settings} />
          )}
          {effectiveView === "settings" && (
            <SettingsView
              settings={settings}
              setSettings={setSettings}
              users={users}
              setUsers={setUsers}
              cloud={cloud}
              setCloud={setCloud}
              cloudStatus={effStatus}
              backupNow={backupNow}
              exportJSON={exportJSON}
              restoreJSON={restoreJSON}
            />
          )}
        </div>
      </div>
      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          settings={settings}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </div>
  );
}

function Sidebar({
  view,
  setView,
  settings,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
  role,
}: {
  view: View;
  setView: (v: View) => void;
  settings: Settings;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  role: Role;
}) {
  const fullName = (settings.restaurantName || "RESTAURANT").trim();
  const words = fullName.split(/\s+/);
  const primary = words[0];
  const secondary = words.slice(1).join(" ") || "POS";
  const allItems: { id: View; label: string; icon: string; admin?: boolean }[] =
    [
      { id: "billing", label: "Billing", icon: "🏠" },
      { id: "tickets", label: "Tickets", icon: "🎫" },
      { id: "menu", label: "Menu Editor", icon: "📋", admin: true },
      { id: "inventory", label: "Inventory", icon: "📦", admin: true },
      { id: "history", label: "Order History", icon: "📜", admin: true },
      { id: "summary", label: "Sales Summary", icon: "📊", admin: true },
      { id: "reports", label: "VAT Reports", icon: "🧾", admin: true },
      { id: "settings", label: "Settings", icon: "⚙️", admin: true },
    ];
  const items = allItems.filter((it) => role === "admin" || !it.admin);
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/50 z-[55] md:hidden"
        />
      )}
      <aside
        className={`fixed md:static inset-y-0 left-0 ${
          collapsed ? "md:w-16" : "md:w-60"
        } w-60 bg-brand-green-dark text-white flex flex-col shrink-0 z-[60] md:relative md:z-10 transform transition-all duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div
          className={`border-b border-white/10 flex items-start justify-between ${
            collapsed ? "md:px-2 md:py-3 px-5 py-6" : "px-5 py-6"
          }`}
        >
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-brand-gold text-xs tracking-widest font-semibold uppercase break-words">
                {primary}
              </div>
              <div className="text-white text-lg font-bold leading-tight mt-1 break-words">
                {secondary}
              </div>
              {settings.restaurantNameAr && (
                <div
                  dir="rtl"
                  className="text-brand-gold/90 text-sm font-semibold mt-1 break-words"
                >
                  {settings.restaurantNameAr}
                </div>
              )}
              <div className="text-white/40 text-[10px] mt-1">
                نظام نقاط البيع
              </div>
            </div>
          )}
          {collapsed && (
            <div className="hidden md:block text-brand-gold text-xs font-bold tracking-widest text-center w-full">
              {primary.charAt(0)}
            </div>
          )}
          <button
            onClick={onClose}
            className="md:hidden text-white/60 hover:text-white text-xl leading-none -mt-1"
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        <nav className="flex-1 py-2">
          {items.map((it) => {
            const active = view === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setView(it.id)}
                title={collapsed ? it.label : undefined}
                className={`w-full text-left flex items-center gap-3 text-sm font-medium transition-all ${
                  collapsed ? "md:px-0 md:justify-center px-5 py-3.5" : "px-5 py-3.5"
                } ${
                  active
                    ? "text-brand-gold border-l-4 border-brand-gold font-semibold"
                    : "text-white border-l-4 border-transparent hover:bg-white/10 hover:border-white/30"
                }`}
              >
                <span className="text-xl shrink-0">{it.icon}</span>
                {!collapsed && <span className="tracking-wide">{it.label}</span>}
              </button>
            );
          })}
        </nav>
        <button
          onClick={onToggleCollapse}
          className="hidden md:flex items-center justify-center py-2 border-t border-white/20 text-white/70 hover:text-brand-gold hover:bg-white/10 text-lg font-bold transition-colors"
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        >
          {collapsed ? "›" : "‹"}
        </button>
        {!collapsed && (
          <div className="bg-brand-gold text-brand-green-dark text-center py-2.5 px-3 border-t-2 border-yellow-300 shadow-[0_-4px_12px_rgba(0,0,0,0.25)]">
            <div className="text-[10px] uppercase font-bold tracking-wider opacity-80 leading-none">
              Powered by
            </div>
            <div className="font-extrabold tracking-[0.18em] text-base leading-tight mt-0.5">
              I-SOLUTIONS
            </div>
          </div>
        )}
        {collapsed && (
          <div className="bg-brand-gold text-brand-green-dark py-2 text-center border-t-2 border-yellow-300">
            <div className="font-extrabold tracking-wider text-[11px] leading-none">
              I·S
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Header({
  now,
  settings,
  onMenuClick,
  session,
  onLogout,
  cloudStatus,
}: {
  now: Date;
  settings: Settings;
  onMenuClick: () => void;
  session: Session;
  onLogout: () => void;
  cloudStatus: CloudStatus;
}) {
  const statusInfo: Record<
    CloudStatus,
    { dot: string; label: string; color: string }
  > = {
    synced: { dot: "🟢", label: "Cloud Synced", color: "text-green-700" },
    syncing: { dot: "🟡", label: "Syncing…", color: "text-yellow-700" },
    offline: { dot: "🟡", label: "Offline Mode", color: "text-yellow-700" },
    error: { dot: "🔴", label: "Sync Failed", color: "text-red-700" },
    disabled: {
      dot: "⚪",
      label: "Cloud Off",
      color: "text-gray-500",
    },
  };
  const s = statusInfo[cloudStatus];
  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 gap-3">
      <button
        onClick={onMenuClick}
        className="md:hidden text-brand-green-dark text-2xl leading-none px-1"
        aria-label="Open menu"
      >
        ☰
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 truncate">
          <span className="text-brand-gold font-black text-2xl sm:text-3xl leading-none drop-shadow-sm tracking-tight">
            {settings.restaurantName?.split(/\s+/)[0]}
          </span>
          <span className="text-brand-green font-semibold text-sm sm:text-base truncate">
            {settings.restaurantName?.split(/\s+/).slice(1).join(" ")}
          </span>
        </div>
        {settings.restaurantNameAr && (
          <div
            dir="rtl"
            className="text-brand-green-dark text-sm font-semibold truncate"
          >
            {settings.restaurantNameAr}
          </div>
        )}
        {(settings.vatNumber || settings.crNumber) && (
          <div className="text-[11px] text-brand-gold font-semibold tracking-wide flex flex-wrap gap-x-3">
            {settings.vatNumber && <span>VAT No: {settings.vatNumber}</span>}
            {settings.crNumber && <span>CR No: {settings.crNumber}</span>}
          </div>
        )}
        <div className="text-xs text-gray-500 truncate hidden sm:block">
          {settings.address}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {cloudStatus !== "disabled" && (
          <div
            title={s.label}
            className={`hidden sm:flex items-center gap-1 text-xs font-semibold ${s.color}`}
          >
            <span>{s.dot}</span>
            <span>{s.label}</span>
          </div>
        )}
        <div className="text-right">
          <div className="text-sm font-mono text-brand-green-dark font-semibold">
            {now.toLocaleTimeString()}
          </div>
          <div className="text-[11px] text-gray-500 hidden sm:block">
            {now.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
          <div className="text-right">
            <div className="text-xs font-bold text-brand-green-dark leading-tight">
              {session.displayName || session.username}
            </div>
            <div
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                session.role === "admin"
                  ? "text-brand-gold"
                  : "text-gray-500"
              }`}
            >
              {session.role}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Logout"
            className="px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-md border border-red-200"
          >
            ⏻ Logout
          </button>
        </div>
      </div>
    </header>
  );
}

// Visual helpers for the menu — emoji per category and a sensible
// per-item emoji guess from common keywords. Keeps the grid lively without
// requiring uploaded images for every dish.
const CATEGORY_EMOJI: Record<string, string> = {
  All: "🍽️",
  Biryani: "🍛",
  "Roti/Bread": "🫓",
  Drinks: "🥤",
  Extras: "✨",
  Desserts: "🍰",
  Soups: "🍲",
  Salads: "🥗",
  Appetizers: "🥟",
  Mains: "🍖",
  Sides: "🍟",
  Breakfast: "🍳",
  Coffee: "☕",
  Tea: "🍵",
  Juices: "🧃",
  Sandwiches: "🥪",
  Burgers: "🍔",
  Pizza: "🍕",
  Pasta: "🍝",
  Seafood: "🦐",
  Chicken: "🍗",
};

function categoryEmoji(c: string): string {
  return CATEGORY_EMOJI[c] || "🍽️";
}

function itemEmoji(item: { name: string; category: string }): string {
  const n = item.name.toLowerCase();
  if (/biryani|rice/.test(n)) return "🍛";
  if (/chai|tea/.test(n)) return "🍵";
  if (/coffee|latte|espresso|cappuccino/.test(n)) return "☕";
  if (/water/.test(n)) return "💧";
  if (/cold|soda|cola|pepsi|sprite|drink|juice/.test(n)) return "🥤";
  if (/naan|roti|bread|khubz/.test(n)) return "🫓";
  if (/burger/.test(n)) return "🍔";
  if (/pizza/.test(n)) return "🍕";
  if (/pasta|spaghetti|noodle/.test(n)) return "🍝";
  if (/sandwich|wrap/.test(n)) return "🥪";
  if (/salad/.test(n)) return "🥗";
  if (/soup|shorba/.test(n)) return "🍲";
  if (/chicken|tikka/.test(n)) return "🍗";
  if (/beef|steak/.test(n)) return "🥩";
  if (/mutton|lamb/.test(n)) return "🍖";
  if (/fish|prawn|shrimp|seafood/.test(n)) return "🦐";
  if (/egg|omelette|omelet/.test(n)) return "🍳";
  if (/cake|dessert|sweet|kunafa|baklava/.test(n)) return "🍰";
  if (/ice cream|kulfi|gelato/.test(n)) return "🍨";
  if (/fries|chips/.test(n)) return "🍟";
  if (/masala|curry/.test(n)) return "🍲";
  if (/samosa|pakora|kebab/.test(n)) return "🥟";
  return categoryEmoji(item.category);
}

// =====================================================================
// Tickets / Token Numbering System
// =====================================================================
type TicketRow = {
  id: string;
  number: number;
  label: string;
  counterName: string | null;
  cashier: string | null;
  notes: string | null;
  createdAt: string;
};

function TicketsView({
  settings,
  session,
}: {
  settings: Settings;
  session: Session | null;
}) {
  const isAdmin = session?.role === "admin";
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [nextLabel, setNextLabel] = useState<string>("T-001");
  const [counterName, setCounterName] = useState<string>(() =>
    storage.get<string>("pos:tickets:counter", ""),
  );
  const [printTicket, setPrintTicket] = useState<TicketRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState<boolean>(() =>
    storage.get<boolean>("pos:tickets:autoPrint", true),
  );

  useEffect(() => {
    storage.set("pos:tickets:counter", counterName);
  }, [counterName]);
  useEffect(() => {
    storage.set("pos:tickets:autoPrint", autoPrint);
  }, [autoPrint]);

  const refresh = useCallback(async () => {
    try {
      const [todayRes, nextRes] = await Promise.all([
        fetch("/api/tickets/today", { credentials: "include" }),
        fetch("/api/tickets/next-preview", { credentials: "include" }),
      ]);
      if (todayRes.ok) {
        const data = await todayRes.json();
        setTickets(data.tickets || []);
        setResetAt(data.resetAt || null);
      }
      if (nextRes.ok) {
        const data = await nextRes.json();
        setNextLabel(data.nextLabel || "T-001");
      }
    } catch (e) {
      // network/offline — show inline error but keep UI usable
      console.warn("[tickets] refresh failed", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15000); // soft auto-refresh every 15s
    return () => clearInterval(t);
  }, [refresh]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tickets/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterName: counterName.trim() || null,
          cashier: session?.username || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const ticket: TicketRow = data.ticket;
      setPrintTicket(ticket);
      await refresh();
      if (autoPrint) {
        // Slight delay so the print modal can render before print() fires.
        setTimeout(() => window.print(), 250);
      }
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "Could not generate ticket — check your connection.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!isAdmin) return;
    if (
      !window.confirm(
        "Reset the ticket counter? The next ticket will start from T-001.",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tickets/reset", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const lastTicket = tickets[0] ?? null;
  const todayCount = tickets.length;
  const nowStr = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-green-dark flex items-center gap-2">
              🎫 Token / Ticket System
            </h1>
            <p className="text-sm text-gray-500 mt-1">{nowStr}</p>
          </div>
          {isAdmin && (
            <button
              onClick={reset}
              disabled={busy}
              className="px-3 py-2 text-sm font-semibold rounded-lg border-2 border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
              title="Reset counter — next ticket will be T-001"
            >
              ↻ Reset Counter
            </button>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              Tickets Today
            </div>
            <div className="text-3xl font-extrabold text-brand-green-dark mt-1">
              {todayCount}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              Next Ticket
            </div>
            <div className="text-3xl font-extrabold text-brand-gold mt-1">
              {nextLabel}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              Last Issued
            </div>
            <div className="text-3xl font-extrabold text-gray-800 mt-1">
              {lastTicket?.label || "—"}
            </div>
            {lastTicket && (
              <div className="text-xs text-gray-500 mt-1">
                {new Date(lastTicket.createdAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>
        </div>

        {/* Generate panel */}
        <div className="bg-gradient-to-br from-brand-green to-brand-green-dark text-white rounded-2xl p-6 shadow-lg mb-6">
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-white/70 mb-1">
                Counter / Cashier (optional)
              </label>
              <input
                type="text"
                value={counterName}
                onChange={(e) => setCounterName(e.target.value)}
                placeholder="e.g. Counter 1, Window A"
                className="w-full px-3 py-2.5 rounded-lg bg-white/95 text-gray-900 placeholder-gray-400 border-2 border-transparent focus:border-brand-gold focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/90 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoPrint}
                onChange={(e) => setAutoPrint(e.target.checked)}
                className="w-4 h-4 accent-brand-gold"
              />
              Auto-print
            </label>
            <button
              onClick={generate}
              disabled={busy}
              className="px-8 py-3.5 bg-brand-gold hover:bg-yellow-500 active:bg-yellow-600 text-brand-green-dark font-extrabold text-lg rounded-xl shadow-lg shadow-black/20 transition-all disabled:opacity-60 whitespace-nowrap flex items-center gap-2"
            >
              {busy ? "..." : <>+ Generate Ticket</>}
            </button>
          </div>
          {err && (
            <div className="mt-3 px-3 py-2 bg-red-500/20 border border-red-400/50 rounded-lg text-sm">
              ⚠ {err}
            </div>
          )}
        </div>

        {/* Recent tickets list */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="font-semibold text-brand-green-dark">
              Today's Tickets
            </div>
            <div className="text-xs text-gray-500">
              {resetAt
                ? `Reset: ${new Date(resetAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </div>
          </div>
          {tickets.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">🎫</div>
              <div>No tickets generated yet today.</div>
              <div className="text-xs mt-1">
                Click "Generate Ticket" above to issue the first one.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto scrollbar-thin">
              {tickets.map((t) => (
                <div
                  key={t.id}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50"
                >
                  <div className="w-20 text-xl font-extrabold text-brand-green-dark">
                    {t.label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">
                      {t.counterName || "—"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(t.createdAt).toLocaleString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}{" "}
                      · {t.cashier || "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => setPrintTicket(t)}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-brand-green hover:text-white hover:border-brand-green transition-colors"
                  >
                    🖨 Reprint
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Print modal */}
      {printTicket && (
        <TicketPrintModal
          ticket={printTicket}
          settings={settings}
          onClose={() => setPrintTicket(null)}
        />
      )}
    </div>
  );
}

function TicketPrintModal({
  ticket,
  settings,
  onClose,
}: {
  ticket: TicketRow;
  settings: Settings;
  onClose: () => void;
}) {
  const created = new Date(ticket.createdAt);
  const fullName = (settings.restaurantName || "Restaurant").trim();
  const words = fullName.split(/\s+/);
  const primary = words[0] || "Asrar";
  const secondary = words.slice(1).join(" ") || "";
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-lg shadow-2xl max-w-sm w-full max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between no-print">
          <div className="font-semibold text-brand-green-dark">
            Ticket {ticket.label}
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded"
          >
            ✕
          </button>
        </div>

        <div
          id="print-ticket"
          className="flex-1 overflow-y-auto px-5 py-5 text-center font-mono"
        >
          {/* Restaurant header */}
          <div className="text-3xl font-extrabold text-brand-gold leading-none">
            {primary}
          </div>
          {secondary && (
            <div className="text-[12px] text-gray-700 font-bold uppercase tracking-wide mt-0.5">
              {secondary}
            </div>
          )}
          {settings.restaurantNameAr && (
            <div className="text-[11px] text-gray-700 mt-0.5" dir="rtl">
              {settings.restaurantNameAr}
            </div>
          )}
          {settings.vatNumber && (
            <div className="text-[10px] text-gray-600 mt-1">
              VAT: {settings.vatNumber}
            </div>
          )}

          <div className="border-t-2 border-dashed border-gray-400 my-3" />

          {/* Big token number */}
          <div className="text-[10px] uppercase tracking-[3px] text-gray-600 font-bold">
            Your Token
          </div>
          <div className="my-2 px-3">
            <div className="inline-block px-6 py-3 border-4 border-brand-green rounded-2xl bg-gradient-to-br from-brand-gold/10 to-white">
              <div className="text-[64px] leading-none font-extrabold text-brand-green-dark tracking-wider">
                {ticket.label}
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="text-[11px] text-gray-700 mt-3 space-y-0.5">
            <div>
              {created.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
              {"  "}
              {created.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
            {ticket.counterName && (
              <div>Counter: <b>{ticket.counterName}</b></div>
            )}
            {ticket.cashier && (
              <div>Cashier: <b>{ticket.cashier}</b></div>
            )}
          </div>

          <div className="border-t-2 border-dashed border-gray-400 my-3" />
          <div className="text-[12px] font-bold text-brand-green-dark">
            Please wait for your token to be called
          </div>
          <div className="text-[11px] text-gray-700 mt-1" dir="rtl">
            يرجى الانتظار حتى يتم استدعاء رقمك
          </div>
          <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-[10px] text-gray-600">
            Thank you · شكراً لكم
          </div>
          <div className="text-center text-[10px] mt-1 font-bold text-black">
            powered by I-Solutions
          </div>
        </div>

        <div className="border-t bg-gray-50 px-3 pt-2 pb-1 text-[10px] text-gray-600 text-center leading-tight no-print">
          Thermal printer:{" "}
          <span className="font-semibold">80mm roll</span> · Set browser
          margins to <span className="font-semibold">None</span>
        </div>
        <div className="px-4 py-3 border-t flex gap-2 no-print">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 px-3 py-2 bg-brand-green hover:bg-brand-green-dark text-white font-bold rounded-md"
          >
            🖨 Print
          </button>
        </div>
      </div>
    </div>
  );
}

function Billing(props: {
  menu: MenuItem[];
  categories: string[];
  activeCategory: string;
  setActiveCategory: (c: string) => void;
  cart: CartItem[];
  addToCart: (i: MenuItem) => void;
  changeQty: (id: string, d: number) => void;
  removeFromCart: (id: string) => void;
  customer: string;
  setCustomer: (s: string) => void;
  discountType: "percent" | "amount";
  setDiscountType: (t: "percent" | "amount") => void;
  discountValue: string;
  setDiscountValue: (v: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  gross: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  settings: Settings;
  placeOrder: () => void;
}) {
  const {
    menu,
    categories,
    activeCategory,
    setActiveCategory,
    cart,
    addToCart,
    changeQty,
    removeFromCart,
    customer,
    setCustomer,
    discountType,
    setDiscountType,
    discountValue,
    setDiscountValue,
    paymentMethod,
    setPaymentMethod,
    gross,
    subtotal,
    discount,
    vat,
    total,
    settings,
    placeOrder,
  } = props;

  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menu.filter((m) => {
      const inCat =
        activeCategory === "All" || m.category === activeCategory;
      if (!inCat) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      );
    });
  }, [menu, activeCategory, searchQuery]);

  // Build a quick lookup of how many of each menu item are already in the cart
  // so we can show a quantity badge on the menu card.
  const cartQty = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cart) m.set(c.id, c.qty);
    return m;
  }, [cart]);

  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);

  // Auto-close mobile cart sheet when cart is emptied (e.g. after Place Order)
  useEffect(() => {
    if (cart.length === 0) setMobileCartOpen(false);
  }, [cart.length]);

  const handlePlaceOrder = () => {
    placeOrder();
    setMobileCartOpen(false);
  };

  return (
    <div className="h-full flex flex-col md:grid md:grid-cols-[1fr_380px] gap-3 md:gap-4 p-3 sm:p-4 overflow-hidden min-h-0 relative">
      {/* Menu grid */}
      <div className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex-1 min-h-0 md:min-h-0">
        {/* Search bar */}
        <div className="px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 text-base pointer-events-none">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search menu items..."
              className="w-full pl-9 pr-9 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-2 my-1 px-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {/* Category pills */}
        <div className="px-4 py-3 border-b border-gray-100 flex gap-2 overflow-x-auto scrollbar-thin shrink-0">
          {["All", ...categories].map((c) => {
            const active = activeCategory === c;
            const count =
              c === "All"
                ? menu.length
                : menu.filter((m) => m.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`px-3.5 py-2 text-sm rounded-full whitespace-nowrap transition-all flex items-center gap-1.5 font-medium ${
                  active
                    ? "bg-gradient-to-br from-brand-green to-brand-green-dark text-white shadow-md shadow-brand-green/30 ring-2 ring-brand-gold ring-offset-1"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <span className="text-base leading-none">
                  {categoryEmoji(c)}
                </span>
                <span>{c}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    active
                      ? "bg-white/25 text-white"
                      : "bg-white text-gray-500 border border-gray-200"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4 scrollbar-thin bg-gradient-to-b from-gray-50/50 to-white">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((item) => {
              const inCart = cartQty.get(item.id) || 0;
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  disabled={!item.available}
                  className={`group relative rounded-xl text-left transition-all overflow-hidden flex flex-col ${
                    item.available
                      ? "bg-white border border-gray-200 hover:border-brand-green hover:shadow-lg hover:shadow-brand-green/10 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md cursor-pointer"
                      : "bg-gray-50 border border-gray-200 opacity-60 cursor-not-allowed"
                  } ${inCart > 0 ? "ring-2 ring-brand-gold ring-offset-1" : ""}`}
                >
                  {/* Cart quantity badge */}
                  {inCart > 0 && (
                    <div className="absolute top-2 right-2 z-10 min-w-[28px] h-7 px-2 bg-brand-gold text-brand-green-dark font-bold text-sm rounded-full flex items-center justify-center shadow-md">
                      ×{inCart}
                    </div>
                  )}
                  {/* Image / emoji area with category-tinted background */}
                  <div
                    className={`relative h-24 sm:h-28 flex items-center justify-center text-5xl sm:text-6xl ${
                      item.available
                        ? "bg-gradient-to-br from-brand-gold/15 via-brand-gold/5 to-brand-green/10"
                        : "bg-gray-100"
                    }`}
                  >
                    <span className="drop-shadow-sm transition-transform group-hover:scale-110 group-active:scale-95">
                      {itemEmoji(item)}
                    </span>
                    <div className="absolute top-1.5 left-1.5 text-[9px] font-bold text-brand-green-dark bg-white/90 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {item.category}
                    </div>
                  </div>
                  {/* Body */}
                  <div className="p-3 pt-2.5 flex-1 flex flex-col">
                    <div className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 min-h-[2.5rem]">
                      {item.name}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-1">
                      <div className="text-brand-green-dark font-extrabold text-lg leading-none">
                        {fmt(item.price, settings.currency)}
                      </div>
                      {item.available ? (
                        <div className="text-[10px] font-bold text-white bg-brand-green px-2 py-1 rounded-md group-hover:bg-brand-green-dark transition-colors">
                          + ADD
                        </div>
                      ) : (
                        <div className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">
                          OUT
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-16">
                <div className="text-5xl mb-3">🍽️</div>
                <div className="text-gray-700 font-semibold mb-1">
                  {searchQuery
                    ? `No items match "${searchQuery}"`
                    : "No items in this category"}
                </div>
                <div className="text-sm text-gray-400">
                  {searchQuery
                    ? "Try a different search term"
                    : "Add items in the Menu tab"}
                </div>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="mt-4 text-sm text-brand-green hover:text-brand-green-dark font-semibold underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile-only floating cart bar — always reachable for checkout */}
      {cart.length > 0 && !mobileCartOpen && (
        <div
          className="md:hidden fixed bottom-0 inset-x-0 z-30 safe-pb pointer-events-none"
        >
          <button
            onClick={() => setMobileCartOpen(true)}
            className="pointer-events-auto w-full bg-brand-green hover:bg-brand-green-dark text-white py-3 px-4 flex justify-between items-center gap-3 shadow-2xl border-t-2 border-brand-gold"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="bg-brand-gold text-brand-green-dark text-xs font-bold rounded-full px-2 py-0.5 shrink-0">
                {itemCount}
              </span>
              <span className="text-sm font-semibold">items</span>
            </span>
            <span className="text-base font-bold whitespace-nowrap">
              {fmt(total, settings.currency)}
            </span>
            <span className="text-sm font-semibold flex items-center gap-1 whitespace-nowrap">
              View Cart <span className="text-brand-gold">→</span>
            </span>
          </button>
        </div>
      )}

      {/* Mobile backdrop when cart sheet is open */}
      {mobileCartOpen && (
        <div
          onClick={() => setMobileCartOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          aria-hidden
        />
      )}

      {/* Cart — inline panel on desktop, slide-up bottom sheet on mobile */}
      <div
        className={`flex flex-col bg-white overflow-hidden transition-transform duration-300 will-change-transform
          md:relative md:rounded-lg md:shadow-sm md:border md:border-gray-200 md:max-h-full
          fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] rounded-t-2xl shadow-2xl border-t-2 border-brand-gold safe-pb
          ${mobileCartOpen ? "translate-y-0" : "translate-y-full md:translate-y-0"}`}
      >
        <div className="px-3 py-2 border-b border-gray-100 bg-brand-green-dark text-white">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm">Current Order</div>
            <div className="text-brand-gold text-xs flex items-center gap-3">
              <span>{itemCount} items</span>
              <button
                onClick={() => setMobileCartOpen(false)}
                className="md:hidden text-white/70 hover:text-white text-2xl leading-none -mr-1 px-2"
                aria-label="Close cart"
              >
                ×
              </button>
            </div>
          </div>
        </div>
        <div className="px-3 py-2 border-b border-gray-100">
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Customer / Table (e.g. Table 5)"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
          />
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {cart.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">
              No items added yet
              <br />
              <span className="text-xs">Tap items to add to order</span>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {cart.map((c) => (
                <li key={c.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 font-medium text-gray-900 text-sm truncate">
                      {c.name}
                    </div>
                    <div className="text-sm font-semibold text-brand-green-dark whitespace-nowrap">
                      {fmt(c.price * c.qty, settings.currency)}
                    </div>
                    <button
                      onClick={() => removeFromCart(c.id)}
                      className="text-red-500 hover:text-red-700 font-bold text-lg leading-none w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 shrink-0"
                      title="Remove"
                      aria-label="Remove item"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[11px] text-gray-500">
                      {fmt(c.price, settings.currency)} each
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(c.id, -1)}
                        className="w-8 h-8 rounded-md bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-base flex items-center justify-center"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">
                        {c.qty}
                      </span>
                      <button
                        onClick={() => changeQty(c.id, 1)}
                        className="w-8 h-8 rounded-md bg-brand-green hover:bg-brand-green-dark active:bg-brand-green-dark text-white font-bold text-base flex items-center justify-center"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-gray-200 px-3 py-2 bg-white">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-14 shrink-0">
              Discount
            </span>
            <div className="flex bg-gray-100 rounded-md p-0.5 shrink-0">
              <button
                onClick={() => setDiscountType("percent")}
                className={`px-2 py-0.5 text-xs font-semibold rounded ${
                  discountType === "percent"
                    ? "bg-white text-brand-green-dark shadow-sm"
                    : "text-gray-600"
                }`}
              >
                %
              </button>
              <button
                onClick={() => setDiscountType("amount")}
                className={`px-2 py-0.5 text-xs font-semibold rounded ${
                  discountType === "amount"
                    ? "bg-white text-brand-green-dark shadow-sm"
                    : "text-gray-600"
                }`}
              >
                {settings.currency}
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === "percent" ? "0%" : "0.00"}
              className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
            {discountValue && (
              <button
                onClick={() => setDiscountValue("")}
                className="text-xs text-gray-500 hover:text-red-600 px-1"
                title="Clear discount"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {[
              { label: "5%", type: "percent" as const, value: "5" },
              { label: "10% Staff", type: "percent" as const, value: "10" },
              { label: "15%", type: "percent" as const, value: "15" },
              { label: "20%", type: "percent" as const, value: "20" },
            ].map((p) => {
              const active =
                discountType === p.type && discountValue === p.value;
              return (
                <button
                  key={p.label}
                  onClick={() => {
                    setDiscountType(p.type);
                    setDiscountValue(p.value);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                    active
                      ? "bg-brand-green text-white border-brand-green"
                      : "bg-white text-brand-green-dark border-gray-300 hover:border-brand-green"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-gray-200 px-3 py-2 bg-white">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-14 shrink-0">
              Payment
            </span>
            <div className="flex gap-1 flex-wrap">
              {PAYMENT_METHODS.map((m) => {
                const active = paymentMethod === m;
                return (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                      active
                        ? "bg-brand-green text-white border-brand-green"
                        : "bg-white text-brand-green-dark border-gray-300 hover:border-brand-green"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="border-t-2 border-brand-gold px-3 py-2 bg-brand-cream space-y-1">
          {discount > 0 && (
            <>
              <Row
                label="Items (incl. VAT)"
                value={fmt(gross, settings.currency)}
              />
              <div className="flex justify-between text-sm">
                <span className="text-red-700">
                  Discount
                  {discountType === "percent" && discountValue
                    ? ` (${discountValue}%)`
                    : ""}
                </span>
                <span className="font-semibold text-red-700">
                  − {fmt(discount, settings.currency)}
                </span>
              </div>
            </>
          )}
          <Row
            label="Subtotal (excl. VAT)"
            value={fmt(subtotal, settings.currency)}
          />
          <Row
            label={`VAT (${settings.vatPercent}%)`}
            value={fmt(vat, settings.currency)}
          />
          <div className="h-px bg-gray-300 my-1.5" />
          <div className="flex justify-between items-baseline">
            <span className="text-brand-green-dark font-bold">TOTAL</span>
            <span className="text-brand-green-dark font-bold text-xl">
              {fmt(total, settings.currency)}
            </span>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={cart.length === 0}
            className="w-full mt-2 py-3 md:py-2.5 bg-brand-green hover:bg-brand-green-dark active:bg-brand-green-dark disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-md transition-colors flex items-center justify-center gap-2 text-base"
          >
            Place Order
            <span className="text-brand-gold">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-700">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function MenuEditor(props: {
  menu: MenuItem[];
  setMenu: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  categories: string[];
  setCategories: React.Dispatch<React.SetStateAction<string[]>>;
  settings: Settings;
}) {
  const { menu, setMenu, categories, setCategories, settings } = props;
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategory, setNewCategory] = useState(categories[0] || "");
  const [newDesc, setNewDesc] = useState("");
  const [newCatName, setNewCatName] = useState("");

  const addItem = () => {
    const price = parseFloat(newPrice);
    if (!newName.trim() || isNaN(price) || price < 0 || !newCategory) return;
    setMenu((m) => [
      ...m,
      {
        id: Date.now().toString(),
        name: newName.trim(),
        price,
        category: newCategory,
        description: newDesc.trim() || undefined,
        available: true,
      },
    ]);
    setNewName("");
    setNewPrice("");
    setNewDesc("");
  };

  const updateItem = (id: string, patch: Partial<MenuItem>) =>
    setMenu((m) => m.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const deleteItem = (id: string) => {
    if (!confirm("Delete this item?")) return;
    setMenu((m) => m.filter((it) => it.id !== id));
  };

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name || categories.includes(name)) return;
    setCategories((c) => [...c, name]);
    setNewCatName("");
  };

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-green-dark">
            Menu Editor
          </h1>
          <p className="text-sm text-gray-500">
            Add, edit, or remove menu items. Toggle availability for out-of-stock items.
          </p>
        </div>

        {/* VAT-inclusive notice */}
        <div className="bg-brand-cream border border-brand-gold rounded-lg px-4 py-3 text-sm text-brand-green-dark">
          <span className="font-bold">Pricing rule:</span> Enter the{" "}
          <span className="font-semibold">final customer price (VAT included)</span>.
          The system automatically extracts {settings.vatPercent}% VAT for the receipt.
          Example: enter <span className="font-mono">20.00</span> → customer pays{" "}
          <span className="font-mono">{settings.currency} 20.00</span>.
        </div>

        {/* Add new item */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-brand-green-dark mb-3">
            Add New Item
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Item name"
              className="md:col-span-4 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="md:col-span-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green bg-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder={`Price incl. VAT (${settings.currency})`}
              type="number"
              step="0.01"
              title="Enter the final customer-facing price. VAT is automatically extracted."
              className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="md:col-span-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
          </div>
          <button
            onClick={addItem}
            className="mt-3 px-4 py-2 bg-brand-green text-white rounded-md text-sm font-semibold hover:bg-brand-green-dark"
          >
            + Add Item
          </button>
        </div>

        {/* Categories manager */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-brand-green-dark mb-3">
            Categories
          </h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((c) => (
              <span
                key={c}
                className="px-3 py-1 bg-brand-cream border border-brand-gold text-brand-green-dark rounded-full text-sm font-medium"
              >
                {c}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="New category name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
            <button
              onClick={addCategory}
              className="px-4 py-2 bg-brand-gold text-brand-green-dark rounded-md text-sm font-semibold hover:brightness-95"
            >
              + Add Category
            </button>
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-green-dark text-white">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Category</th>
                <th className="text-right px-4 py-3 font-semibold w-32">
                  Price ({settings.currency})
                </th>
                <th className="text-center px-4 py-3 font-semibold w-32">
                  Available
                </th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {menu.map((it) => (
                <tr key={it.id} className="hover:bg-brand-cream/40">
                  <td className="px-4 py-2">
                    <input
                      value={it.name}
                      onChange={(e) =>
                        updateItem(it.id, { name: e.target.value })
                      }
                      className="w-full bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={it.category}
                      onChange={(e) =>
                        updateItem(it.id, { category: e.target.value })
                      }
                      className="bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={it.price}
                      onChange={(e) =>
                        updateItem(it.id, {
                          price: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-24 text-right bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none font-semibold text-brand-green"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() =>
                        updateItem(it.id, { available: !it.available })
                      }
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        it.available
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {it.available ? "Available" : "Out of Stock"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteItem(it.id)}
                      className="text-red-600 hover:text-red-800 text-xs font-semibold"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {menu.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center text-gray-400 py-8"
                  >
                    No menu items yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Inventory (Raw Materials)
// ============================================================
function Inventory({
  rawMaterials,
  setRawMaterials,
  settings,
}: {
  rawMaterials: RawMaterial[];
  setRawMaterials: React.Dispatch<React.SetStateAction<RawMaterial[]>>;
  settings: Settings;
}) {
  const [search, setSearch] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Add new material form
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("kg");
  const [newStock, setNewStock] = useState("");
  const [newThreshold, setNewThreshold] = useState("");
  const [newCost, setNewCost] = useState("");

  const filtered = useMemo(() => {
    return rawMaterials
      .filter((it) =>
        search.trim()
          ? it.name.toLowerCase().includes(search.trim().toLowerCase())
          : true,
      )
      .filter((it) => {
        if (!showLowOnly) return true;
        return it.stock <= it.lowStockThreshold;
      });
  }, [rawMaterials, search, showLowOnly]);

  const stats = useMemo(() => {
    let low = 0;
    let out = 0;
    let totalValue = 0;
    for (const it of rawMaterials) {
      if (it.stock === 0) out++;
      else if (it.stock <= it.lowStockThreshold) low++;
      if (typeof it.costPerUnit === "number") {
        totalValue += it.stock * it.costPerUnit;
      }
    }
    return { total: rawMaterials.length, low, out, totalValue };
  }, [rawMaterials]);

  const adjust = (id: string, delta: number) => {
    setRawMaterials((m) =>
      m.map((it) =>
        it.id === id ? { ...it, stock: Math.max(0, it.stock + delta) } : it,
      ),
    );
  };

  const setStock = (id: string, value: number) => {
    setRawMaterials((m) =>
      m.map((it) =>
        it.id === id ? { ...it, stock: Math.max(0, Math.floor(value)) } : it,
      ),
    );
  };

  const setThreshold = (id: string, value: number) => {
    setRawMaterials((m) =>
      m.map((it) =>
        it.id === id
          ? { ...it, lowStockThreshold: Math.max(0, Math.floor(value)) }
          : it,
      ),
    );
  };

  const setUnit = (id: string, unit: string) => {
    setRawMaterials((m) =>
      m.map((it) => (it.id === id ? { ...it, unit } : it)),
    );
  };

  const setCost = (id: string, cost: number | undefined) => {
    setRawMaterials((m) =>
      m.map((it) =>
        it.id === id
          ? {
              ...it,
              costPerUnit:
                cost === undefined || isNaN(cost) ? undefined : Math.max(0, cost),
            }
          : it,
      ),
    );
  };

  const removeItem = (id: string) => {
    const it = rawMaterials.find((x) => x.id === id);
    if (!it) return;
    if (
      window.confirm(
        `Remove "${it.name}" from inventory? This cannot be undone.`,
      )
    ) {
      setRawMaterials((m) => m.filter((x) => x.id !== id));
    }
  };

  const startEdit = (id: string, current: number) => {
    setEditingId(id);
    setEditValue(String(current));
  };

  const commitEdit = (id: string) => {
    const v = editValue.trim();
    if (v !== "") {
      const n = parseFloat(v);
      if (!isNaN(n)) setStock(id, n);
    }
    setEditingId(null);
    setEditValue("");
  };

  const addMaterial = () => {
    const name = newName.trim();
    if (!name) {
      alert("Please enter a name for the raw material.");
      return;
    }
    const stock = parseFloat(newStock) || 0;
    const threshold = parseFloat(newThreshold) || 0;
    const cost = newCost.trim() === "" ? undefined : parseFloat(newCost);
    const item: RawMaterial = {
      id: `rm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      unit: newUnit.trim() || "pcs",
      stock: Math.max(0, Math.floor(stock)),
      lowStockThreshold: Math.max(0, Math.floor(threshold)),
      costPerUnit: cost !== undefined && !isNaN(cost) ? Math.max(0, cost) : undefined,
    };
    setRawMaterials((m) => [item, ...m]);
    setNewName("");
    setNewUnit("kg");
    setNewStock("");
    setNewThreshold("");
    setNewCost("");
  };

  const UNIT_OPTIONS = ["kg", "g", "L", "ml", "pcs", "pack", "box", "bag"];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-green-dark">
            Raw Materials Inventory
          </h2>
          <p className="text-sm text-gray-500">
            Track stock of ingredients and supplies (rice, chicken, oil, flour,
            etc.). Independent of menu items.
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">
            Total Items
          </div>
          <div className="text-2xl font-bold text-brand-green-dark mt-1">
            {stats.total}
          </div>
          <div className="text-[10px] text-gray-400">raw materials</div>
        </div>
        <div
          className={`border rounded-lg p-3 shadow-sm cursor-pointer ${
            stats.low > 0
              ? "bg-amber-50 border-amber-300"
              : "bg-white border-gray-200"
          }`}
          onClick={() => setShowLowOnly((v) => !v)}
          title="Click to filter low-stock items"
        >
          <div className="text-[11px] text-amber-700 uppercase tracking-wider">
            Low Stock
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-1">
            {stats.low}
          </div>
          <div className="text-[10px] text-amber-600">at or below threshold</div>
        </div>
        <div
          className={`border rounded-lg p-3 shadow-sm ${
            stats.out > 0
              ? "bg-red-50 border-red-300"
              : "bg-white border-gray-200"
          }`}
        >
          <div className="text-[11px] text-red-700 uppercase tracking-wider">
            Out of Stock
          </div>
          <div className="text-2xl font-bold text-red-700 mt-1">{stats.out}</div>
          <div className="text-[10px] text-red-600">need restock</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">
            Inventory Value
          </div>
          <div className="text-xl font-bold text-brand-green-dark mt-1">
            {fmt(stats.totalValue, settings.currency)}
          </div>
          <div className="text-[10px] text-gray-400">at cost price</div>
        </div>
      </div>

      {/* Add new material form */}
      <div className="bg-white border-2 border-brand-green/30 rounded-lg p-4 shadow-sm">
        <div className="text-sm font-bold text-brand-green-dark mb-3 flex items-center gap-2">
          <span className="text-base">➕</span>
          Add New Raw Material
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <div className="lg:col-span-2">
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Name *
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Basmati Rice"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Unit
            </label>
            <select
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green bg-white"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Initial Stock
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={newStock}
              onChange={(e) => setNewStock(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Low Alert
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={newThreshold}
              onChange={(e) => setNewThreshold(e.target.value)}
              placeholder="5"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Cost / Unit
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              placeholder={`${settings.currency} (opt)`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
            />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={addMaterial}
            className="px-5 py-2 bg-brand-green hover:bg-brand-green-dark text-white text-sm font-bold rounded-md shadow-sm"
          >
            Add Material
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search materials…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showLowOnly}
            onChange={(e) => setShowLowOnly(e.target.checked)}
            className="w-4 h-4"
          />
          Low / out only
        </label>
      </div>

      {/* Items list */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {/* Header (desktop) */}
        <div className="hidden md:grid grid-cols-[2fr_0.7fr_2fr_0.8fr_1fr_0.8fr_0.6fr] gap-3 px-4 py-2 border-b border-gray-200 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-600">
          <div>Material</div>
          <div className="text-center">Unit</div>
          <div className="text-center">Stock</div>
          <div className="text-center">Low Alert</div>
          <div className="text-right">Cost / Unit</div>
          <div className="text-center">Status</div>
          <div className="text-center">Actions</div>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            {rawMaterials.length === 0
              ? "No raw materials yet. Add one using the form above."
              : "No items match your filters."}
          </div>
        )}
        {filtered.map((it) => {
          const status: "out" | "low" | "ok" =
            it.stock === 0 ? "out" : it.stock <= it.lowStockThreshold ? "low" : "ok";
          const statusBadge = {
            out: { label: "OUT", color: "bg-red-100 text-red-800 border-red-300" },
            low: {
              label: "LOW",
              color: "bg-amber-100 text-amber-800 border-amber-300",
            },
            ok: {
              label: "OK",
              color: "bg-green-100 text-green-800 border-green-300",
            },
          }[status];
          return (
            <div
              key={it.id}
              className={`grid grid-cols-2 md:grid-cols-[2fr_0.7fr_2fr_0.8fr_1fr_0.8fr_0.6fr] gap-2 md:gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 items-center ${
                status === "out"
                  ? "bg-red-50/40"
                  : status === "low"
                    ? "bg-amber-50/40"
                    : ""
              }`}
            >
              {/* Name */}
              <div className="font-semibold text-brand-green-dark md:col-span-1 col-span-2">
                {it.name}
              </div>
              {/* Unit */}
              <div className="md:text-center">
                <span className="md:hidden text-[10px] text-gray-500 mr-1">
                  Unit:
                </span>
                <select
                  value={it.unit}
                  onChange={(e) => setUnit(it.id, e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded-md text-xs bg-white focus:outline-none focus:border-brand-green"
                >
                  {UNIT_OPTIONS.includes(it.unit) ? null : (
                    <option value={it.unit}>{it.unit}</option>
                  )}
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              {/* Stock controls */}
              <div className="flex items-center justify-center gap-1.5">
                <button
                  onClick={() => adjust(it.id, -1)}
                  disabled={it.stock === 0}
                  className="w-8 h-8 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 font-bold"
                  title="Decrease by 1"
                >
                  −
                </button>
                {editingId === it.id ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    autoFocus
                    value={editValue}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(it.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(it.id);
                      if (e.key === "Escape") {
                        setEditingId(null);
                        setEditValue("");
                      }
                    }}
                    className="w-20 text-center px-2 py-1 border border-brand-green rounded-md text-sm font-bold focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => startEdit(it.id, it.stock)}
                    className="w-20 text-center px-2 py-1 border border-gray-300 rounded-md text-sm font-bold hover:border-brand-green hover:bg-gray-50"
                    title="Click to set exact stock"
                  >
                    {it.stock}
                  </button>
                )}
                <button
                  onClick={() => adjust(it.id, 1)}
                  className="w-8 h-8 rounded-md bg-brand-green hover:bg-brand-green-dark text-white font-bold"
                  title="Increase by 1"
                >
                  +
                </button>
                <span className="ml-1 text-[10px] text-gray-500 font-semibold">
                  {it.unit}
                </span>
              </div>
              {/* Low alert threshold */}
              <div className="flex items-center justify-center gap-1">
                <span className="md:hidden text-[10px] text-gray-500">
                  Alert:
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={it.lowStockThreshold}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (!isNaN(n)) setThreshold(it.id, n);
                  }}
                  className="w-16 text-center px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
                />
              </div>
              {/* Cost / Unit */}
              <div className="flex items-center justify-end gap-1">
                <span className="md:hidden text-[10px] text-gray-500">Cost:</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={it.costPerUnit ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") setCost(it.id, undefined);
                    else {
                      const n = parseFloat(v);
                      setCost(it.id, n);
                    }
                  }}
                  placeholder="—"
                  className="w-20 text-right px-2 py-1 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:border-brand-green"
                />
                <span className="text-[10px] text-gray-500">
                  {settings.currency}
                </span>
              </div>
              {/* Status badge */}
              <div className="flex justify-center">
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-full border ${statusBadge.color}`}
                >
                  {statusBadge.label}
                </span>
              </div>
              {/* Actions */}
              <div className="flex justify-center">
                <button
                  onClick={() => removeItem(it.id)}
                  className="px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 hover:border-red-400 rounded-md"
                  title="Delete this material"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-gray-500 px-1">
        Tip: Click a stock number to type an exact quantity. Use the +/− buttons
        for quick adjustments. Cost per unit is optional and used to calculate
        total inventory value.
      </div>
    </div>
  );
}


function History({
  orders,
  settings,
  onReprint,
}: {
  orders: Order[];
  settings: Settings;
  onReprint: (o: Order) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-brand-green-dark mb-1">
          Order History
        </h1>
        <p className="text-sm text-gray-500 mb-5">
          {orders.length} orders saved · click any order to reprint receipt
        </p>
        {orders.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg py-16 text-center text-gray-400">
            No orders yet. Start by placing one from the Billing screen.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div
                key={o.id}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-brand-gold transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-brand-gold font-mono text-sm font-bold">
                        #{o.id}
                      </span>
                      <span className="text-gray-900 font-semibold">
                        {o.customer}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(o.date).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      {o.items
                        .map((i) => `${i.name} ×${i.qty}`)
                        .join("  ·  ")}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-brand-green-dark font-bold text-lg">
                      {fmt(o.total, settings.currency)}
                    </div>
                    <button
                      onClick={() => onReprint(o)}
                      className="mt-2 text-xs px-3 py-1 bg-brand-green-dark text-white rounded-md hover:bg-brand-green"
                    >
                      Reprint
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  setSettings,
  users,
  setUsers,
  cloud,
  setCloud,
  cloudStatus,
  backupNow,
  exportJSON,
  restoreJSON,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  cloud: CloudSettings;
  setCloud: React.Dispatch<React.SetStateAction<CloudSettings>>;
  cloudStatus: CloudStatus;
  backupNow: () => Promise<string>;
  exportJSON: () => void;
  restoreJSON: (file: File) => void;
}) {
  const [tab, setTab] = useState<"general" | "users" | "cloud">("general");
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  const save = () => {
    setSettings({
      ...draft,
      vatPercent: Number(draft.vatPercent) || 0,
    });
    alert("Settings saved.");
  };

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-brand-green-dark mb-3">
          Settings
        </h1>
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          {(
            [
              { id: "general", label: "General" },
              { id: "users", label: "Users & Login" },
              { id: "cloud", label: "Cloud Backup" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-brand-green text-brand-green-dark"
                  : "border-transparent text-gray-500 hover:text-brand-green-dark"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <UsersPanel users={users} setUsers={setUsers} />
        )}
        {tab === "cloud" && (
          <CloudPanel
            cloud={cloud}
            setCloud={setCloud}
            cloudStatus={cloudStatus}
            backupNow={backupNow}
            exportJSON={exportJSON}
            restoreJSON={restoreJSON}
          />
        )}
        {tab === "general" && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm space-y-4">
          <Field label="Restaurant Name (English)">
            <input
              value={draft.restaurantName}
              onChange={(e) =>
                setDraft({ ...draft, restaurantName: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
          </Field>
          <Field label="Restaurant Name (Arabic) - اسم المطعم">
            <input
              dir="rtl"
              value={draft.restaurantNameAr}
              onChange={(e) =>
                setDraft({ ...draft, restaurantNameAr: e.target.value })
              }
              placeholder="مثال: مطعم البركة"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green text-right"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown in the navigation, header, and on the receipt.
            </p>
          </Field>
          <Field label="VAT Registration Number">
            <input
              value={draft.vatNumber}
              onChange={(e) =>
                setDraft({ ...draft, vatNumber: e.target.value })
              }
              placeholder="e.g. 300123456700003"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown under the restaurant name on receipts and in the app header.
            </p>
          </Field>
          <Field label="Commercial Registration (CR) Number">
            <input
              value={draft.crNumber}
              onChange={(e) => setDraft({ ...draft, crNumber: e.target.value })}
              placeholder="e.g. 1010123456"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown alongside the VAT number on receipts and header.
            </p>
          </Field>
          <Field label="Address">
            <input
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="e.g. King Fahd Rd, Riyadh"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="VAT Percentage (%)">
              <input
                type="number"
                step="0.1"
                value={draft.vatPercent}
                onChange={(e) =>
                  setDraft({ ...draft, vatPercent: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
              />
              <p className="text-xs text-gray-500 mt-1">
                Saudi standard VAT is 15%
              </p>
            </Field>
            <Field label="Currency Symbol">
              <input
                value={draft.currency}
                onChange={(e) =>
                  setDraft({ ...draft, currency: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
              />
              <p className="text-xs text-gray-500 mt-1">
                Default: SAR (ر.س)
              </p>
            </Field>
          </div>
          <button
            onClick={save}
            className="w-full mt-2 py-3 bg-brand-green text-white font-bold rounded-md hover:bg-brand-green-dark"
          >
            Save Settings
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Summary({
  orders,
  settings,
}: {
  orders: Order[];
  settings: Settings;
}) {
  const [range, setRange] = useState<"today" | "week" | "month" | "all">(
    "today",
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    if (range === "today") start.setHours(0, 0, 0, 0);
    else if (range === "week") start.setDate(now.getDate() - 6);
    else if (range === "month") start.setDate(now.getDate() - 29);
    else start.setTime(0);
    return orders.filter((o) => new Date(o.date) >= start);
  }, [orders, range]);

  const totalRevenue = filtered.reduce((s, o) => s + o.total, 0);
  const totalVat = filtered.reduce((s, o) => s + o.vat, 0);
  const orderCount = filtered.length;
  const avgOrder = orderCount ? totalRevenue / orderCount : 0;
  const itemsSold = filtered.reduce(
    (s, o) => s + o.items.reduce((x, i) => x + i.qty, 0),
    0,
  );

  // Top items
  const itemMap = new Map<
    string,
    { name: string; qty: number; revenue: number }
  >();
  filtered.forEach((o) =>
    o.items.forEach((i) => {
      const cur = itemMap.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      cur.qty += i.qty;
      cur.revenue += i.price * i.qty;
      itemMap.set(i.name, cur);
    }),
  );
  const topItems = [...itemMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Payment method breakdown
  const paymentMap = new Map<string, { count: number; revenue: number }>();
  filtered.forEach((o) => {
    const m = o.paymentMethod || "Cash";
    const cur = paymentMap.get(m) || { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += o.total;
    paymentMap.set(m, cur);
  });
  const payments = [...paymentMap.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const paymentTotal = payments.reduce((s, p) => s + p.revenue, 0) || 1;

  // Daily breakdown
  const dailyMap = new Map<string, { date: string; orders: number; revenue: number }>();
  filtered.forEach((o) => {
    const d = new Date(o.date).toISOString().slice(0, 10);
    const cur = dailyMap.get(d) || { date: d, orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += o.total;
    dailyMap.set(d, cur);
  });
  const daily = [...dailyMap.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const maxDaily = Math.max(1, ...daily.map((d) => d.revenue));

  const exportCSV = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(
      [
        "Order ID",
        "Date",
        "Time",
        "Customer",
        "Payment",
        "Item",
        "Qty",
        `Unit Price (${settings.currency})`,
        `Line Total (${settings.currency})`,
        `Order Subtotal (${settings.currency})`,
        `VAT (${settings.currency})`,
        `Order Total (${settings.currency})`,
      ]
        .map(esc)
        .join(","),
    );
    filtered.forEach((o) => {
      const d = new Date(o.date);
      o.items.forEach((i) => {
        lines.push(
          [
            o.id,
            d.toLocaleDateString(),
            d.toLocaleTimeString(),
            o.customer,
            o.paymentMethod || "Cash",
            i.name,
            i.qty,
            i.price.toFixed(2),
            (i.price * i.qty).toFixed(2),
            o.subtotal.toFixed(2),
            o.vat.toFixed(2),
            o.total.toFixed(2),
          ]
            .map(esc)
            .join(","),
        );
      });
    });
    lines.push("");
    lines.push(
      [
        "TOTALS",
        "",
        "",
        "",
        "",
        "",
        itemsSold,
        "",
        "",
        filtered.reduce((s, o) => s + o.subtotal, 0).toFixed(2),
        totalVat.toFixed(2),
        totalRevenue.toFixed(2),
      ]
        .map(esc)
        .join(","),
    );
    const csv = "\ufeff" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `sales-${range}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const ranges: { id: typeof range; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "Last 7 Days" },
    { id: "month", label: "Last 30 Days" },
    { id: "all", label: "All Time" },
  ];

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-green-dark">
              Sales Summary
            </h1>
            <p className="text-sm text-gray-500">
              Revenue, top items and order trends
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {ranges.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  range === r.id
                    ? "bg-brand-green text-white"
                    : "bg-white border border-gray-200 text-gray-700 hover:border-brand-green"
                }`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="px-3 py-1.5 text-sm rounded-md bg-brand-gold text-brand-green-dark font-semibold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              ⬇ Export CSV
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Total Revenue"
            value={fmt(totalRevenue, settings.currency)}
            accent
          />
          <Stat label="Orders" value={orderCount.toString()} />
          <Stat
            label="Avg Order"
            value={fmt(avgOrder, settings.currency)}
          />
          <Stat
            label="Items Sold"
            value={itemsSold.toString()}
            sub={`VAT collected: ${fmt(totalVat, settings.currency)}`}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg py-16 text-center text-gray-400">
            No orders in this period yet.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top items */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
              <h2 className="font-semibold text-brand-green-dark mb-3">
                Top Selling Items
              </h2>
              <ul className="space-y-3">
                {topItems.map((it, i) => {
                  const max = topItems[0]?.qty || 1;
                  const pct = (it.qty / max) * 100;
                  return (
                    <li key={it.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-900">
                          <span className="text-brand-gold mr-2">
                            #{i + 1}
                          </span>
                          {it.name}
                        </span>
                        <span className="text-gray-600">
                          {it.qty} × · {fmt(it.revenue, settings.currency)}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-green rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Payment methods */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
              <h2 className="font-semibold text-brand-green-dark mb-3">
                Payment Methods
              </h2>
              {payments.length === 0 ? (
                <div className="text-sm text-gray-500">No orders yet.</div>
              ) : (
                <ul className="space-y-3">
                  {payments.map((p) => {
                    const pct = (p.revenue / paymentTotal) * 100;
                    return (
                      <li key={p.method}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-900">
                            {p.method}
                            <span className="text-gray-500 ml-2">
                              · {p.count} order{p.count === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="text-gray-700">
                            {fmt(p.revenue, settings.currency)}
                            <span className="text-gray-500 ml-2">
                              ({pct.toFixed(0)}%)
                            </span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-gold rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Daily breakdown */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
              <h2 className="font-semibold text-brand-green-dark mb-3">
                Daily Revenue
              </h2>
              <ul className="space-y-2">
                {daily.slice(0, 10).map((d) => {
                  const pct = (d.revenue / maxDaily) * 100;
                  const dt = new Date(d.date + "T00:00:00");
                  return (
                    <li key={d.date}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-700 font-medium">
                          {dt.toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="text-gray-600">
                          {d.orders} orders ·{" "}
                          <span className="font-semibold text-brand-green-dark">
                            {fmt(d.revenue, settings.currency)}
                          </span>
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-gold rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 shadow-sm ${
        accent
          ? "bg-brand-green-dark border-brand-gold text-white"
          : "bg-white border-gray-200"
      }`}
    >
      <div
        className={`text-[11px] uppercase tracking-wider font-semibold ${
          accent ? "text-brand-gold" : "text-gray-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`text-xl font-bold mt-1 ${
          accent ? "text-white" : "text-brand-green-dark"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div
          className={`text-[11px] mt-1 ${
            accent ? "text-white/70" : "text-gray-500"
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function ReceiptModal({
  order,
  settings,
  onClose,
}: {
  order: Order;
  settings: Settings;
  onClose: () => void;
}) {
  const date = new Date(order.date);
  // QR points to a public invoice page so customers scanning the receipt
  // with their phone camera land on a clean web page showing the bill amount,
  // items, VAT, and seller info — instead of seeing raw ZATCA TLV bytes.
  // Local order.id is a numeric counter (e.g. 1004); the backend stores it
  // prefixed as "ORD-1004" (see serverSync.tsx where id: `ORD-${o.id}`).
  const backendId = `ORD-${order.id}`;
  const invoiceUrl = `${window.location.origin}/api/public/invoice/${encodeURIComponent(backendId)}`;
  // Keep the ZATCA-compliant TLV available too (unused for now, but ready for
  // ZATCA Phase 2 compliance if needed in the future).
  void buildZatcaQR({
    sellerName: settings.restaurantName,
    vatNumber: settings.vatNumber,
    timestamp: date.toISOString(),
    total: order.total,
    vat: order.vat,
  });
  const qrPayload = invoiceUrl;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-sm w-full max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold text-brand-green-dark">
            Receipt #{order.id}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div
          id="print-receipt"
          className="overflow-y-auto p-4 font-mono text-[12px] text-gray-900"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          <div className="text-center">
            <div
              className="font-extrabold leading-none"
              style={{ fontSize: "24px", letterSpacing: "0.04em" }}
            >
              {settings.restaurantName?.split(/\s+/)[0]}
            </div>
            <div className="font-bold text-base mt-0.5">
              {settings.restaurantName?.split(/\s+/).slice(1).join(" ")}
            </div>
            {settings.restaurantNameAr && (
              <div dir="rtl" className="font-bold text-base">
                {settings.restaurantNameAr}
              </div>
            )}
            {settings.vatNumber && (
              <div className="text-[11px] mt-1 font-bold">
                VAT No: {settings.vatNumber}
              </div>
            )}
            {settings.crNumber && (
              <div className="text-[11px] font-bold">
                CR No: {settings.crNumber}
              </div>
            )}
            <div className="text-[10px] mt-0.5">{settings.address}</div>
            <div className="text-[10px]">VAT {settings.vatPercent}%</div>
          </div>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <div className="flex justify-between text-[11px]">
            <span>Order: #{order.id}</span>
            <span>{date.toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>Customer: {order.customer}</span>
            <span>{date.toLocaleTimeString()}</span>
          </div>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <div className="flex font-bold text-[11px]">
            <div className="flex-1">Item</div>
            <div className="w-8 text-center">Qty</div>
            <div className="w-14 text-right">Price</div>
            <div className="w-16 text-right">Total</div>
          </div>
          <div className="border-t border-dashed border-gray-400 my-1" />
          {order.items.map((it) => (
            <div key={it.id} className="flex text-[11px] py-0.5">
              <div className="flex-1 truncate pr-1">{it.name}</div>
              <div className="w-8 text-center">{it.qty}</div>
              <div className="w-14 text-right">{it.price.toFixed(2)}</div>
              <div className="w-16 text-right">
                {(it.price * it.qty).toFixed(2)}
              </div>
            </div>
          ))}
          <div className="text-[10px] text-gray-600 mt-1 italic">
            * All item prices include VAT
          </div>
          <div className="border-t border-dashed border-gray-400 my-2" />
          {order.discount > 0 && (
            <>
              <div className="flex justify-between text-[11px]">
                <span>Items (incl. VAT)</span>
                <span>
                  {fmt(order.subtotal + order.vat + order.discount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>
                  Discount
                  {order.discountType === "percent" && order.discountValue
                    ? ` (${order.discountValue}%)`
                    : ""}
                </span>
                <span>− {fmt(order.discount, settings.currency)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-[11px]">
            <span>Subtotal (excl. VAT)</span>
            <span>{fmt(order.subtotal, settings.currency)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>VAT ({settings.vatPercent}%)</span>
            <span>{fmt(order.vat, settings.currency)}</span>
          </div>
          <div className="border-t border-double border-gray-700 my-1" />
          <div className="flex justify-between font-bold text-sm">
            <span>GRAND TOTAL (incl. VAT)</span>
            <span>{fmt(order.total, settings.currency)}</span>
          </div>
          <div className="text-right text-[11px] font-bold">
            ر.س {order.total.toFixed(2)}
          </div>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <div className="flex justify-between text-[11px]">
            <span>Payment</span>
            <span className="font-semibold">{order.paymentMethod || "Cash"}</span>
          </div>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <div className="flex justify-center my-3 qr-print bg-white p-1">
            <QRCodeSVG
              value={qrPayload}
              size={120}
              level="M"
              fgColor="#000000"
              bgColor="#FFFFFF"
              includeMargin={true}
            />
          </div>
          <div className="text-center text-[10px] mb-2">
            Scan for order details
          </div>
          <div className="text-center text-[12px] font-bold mt-3">
            شكراً لزيارتكم
          </div>
          <div className="text-center text-[11px]">
            Thank you for visiting!
          </div>
          <div className="text-center text-[10px] mt-1 text-gray-600">
            Please come again
          </div>
          <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-[10px] text-gray-700">
            نظام نقاط البيع · {new Date().getFullYear()}
          </div>
          <div className="text-center text-[10px] mt-1 font-bold text-black">
            powered by I-Solutions
          </div>
        </div>
        <div className="border-t bg-gray-50 px-3 pt-2 pb-1 text-[10px] text-gray-600 text-center leading-tight no-print">
          Thermal printer: <span className="font-semibold">80mm roll</span> · Set browser margins to <span className="font-semibold">None</span> · Disable headers &amp; footers
        </div>
        <div className="border-t p-3 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-md text-sm font-semibold hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 py-2 bg-brand-green text-white rounded-md text-sm font-semibold hover:bg-brand-green-dark"
          >
            🖨 Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LoginScreen
// ============================================================
function LoginScreen({
  settings,
  onLogin,
}: {
  settings: Settings;
  onLogin: (u: string, p: string) => string | null;
}) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = onLogin(u, p);
    if (res) setErr(res);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{
        background:
          "linear-gradient(135deg, var(--brand-green-dark) 0%, var(--brand-green) 100%)",
      }}
    >
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6 text-white">
          <img
            src={logoUrl}
            alt="Restaurant logo"
            className="mx-auto mb-3 drop-shadow-2xl"
            style={{
              width: 140,
              height: 140,
              objectFit: "contain",
            }}
          />
          <div
            className="text-brand-gold font-black leading-none drop-shadow-[0_4px_24px_rgba(251,191,36,0.45)]"
            style={{ fontSize: "4rem", letterSpacing: "0.02em" }}
          >
            {settings.restaurantName?.split(/\s+/)[0] || "RESTAURANT"}
          </div>
          <div className="text-white text-base font-semibold leading-tight mt-2 tracking-wide">
            {settings.restaurantName?.split(/\s+/).slice(1).join(" ") || "POS"}
          </div>
          {settings.restaurantNameAr && (
            <div dir="rtl" className="text-brand-gold/90 text-lg font-semibold mt-1">
              {settings.restaurantNameAr}
            </div>
          )}
          <div className="text-white/60 text-xs mt-2">
            Point of Sale System · نظام نقاط البيع
          </div>
        </div>
        <form
          onSubmit={submit}
          className="bg-white rounded-xl shadow-2xl p-6 space-y-4"
        >
          <h2 className="text-lg font-bold text-brand-green-dark text-center">
            Sign In
          </h2>
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Username
            </label>
            <input
              autoFocus
              name="username"
              autoComplete="username"
              value={u}
              onChange={(e) => {
                setU(e.target.value);
                setErr(null);
              }}
              placeholder="admin or cashier1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Password
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={p}
              onChange={(e) => {
                setP(e.target.value);
                setErr(null);
              }}
              placeholder="••••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-brand-green"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 bg-brand-green text-white font-bold rounded-md hover:bg-brand-green-dark"
          >
            Login →
          </button>
          <div className="text-center text-[10px] text-gray-400 mt-2">
            Session expires after 8 hours
          </div>
        </form>
        <div className="text-center mt-4 text-[10px] text-white/40">
          نظام نقاط البيع · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// UsersPanel (admin only)
// ============================================================
function UsersPanel({
  users,
  setUsers,
}: {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
}) {
  const [nu, setNu] = useState("");
  const [np, setNp] = useState("");
  const [nr, setNr] = useState<Role>("cashier");
  const [nd, setNd] = useState("");

  const addUser = () => {
    const username = nu.trim();
    if (!username || !np) {
      alert("Username and password are required.");
      return;
    }
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      alert("That username already exists.");
      return;
    }
    setUsers((us) => [
      ...us,
      { username, password: np, role: nr, displayName: nd.trim() || username },
    ]);
    setNu("");
    setNp("");
    setNd("");
    setNr("cashier");
  };

  const updateUser = (idx: number, patch: Partial<User>) => {
    if (patch.role && patch.role !== "admin") {
      const target = users[idx];
      if (
        target?.role === "admin" &&
        users.filter((x) => x.role === "admin").length === 1
      ) {
        alert(
          "Cannot change the role of the last admin. Add another admin first.",
        );
        return;
      }
    }
    setUsers((us) => us.map((u, i) => (i === idx ? { ...u, ...patch } : u)));
  };

  const deleteUser = (idx: number) => {
    const u = users[idx];
    if (u.role === "admin" && users.filter((x) => x.role === "admin").length === 1) {
      alert("Cannot delete the last admin user.");
      return;
    }
    if (!confirm(`Delete user "${u.username}"?`)) return;
    setUsers((us) => us.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-brand-green-dark mb-3">
          Add New User
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <input
            value={nu}
            onChange={(e) => setNu(e.target.value)}
            placeholder="Username (e.g. cashier2)"
            className="md:col-span-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
          />
          <input
            value={nd}
            onChange={(e) => setNd(e.target.value)}
            placeholder="Display name (optional)"
            className="md:col-span-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
          />
          <input
            type="text"
            value={np}
            onChange={(e) => setNp(e.target.value)}
            placeholder="Password"
            className="md:col-span-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-brand-green"
          />
          <select
            value={nr}
            onChange={(e) => setNr(e.target.value as Role)}
            className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:border-brand-green"
          >
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={addUser}
            className="md:col-span-1 px-3 py-2 bg-brand-green text-white rounded-md text-sm font-semibold hover:bg-brand-green-dark"
          >
            + Add
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          <span className="font-semibold text-brand-green-dark">Admin</span>{" "}
          can access everything.{" "}
          <span className="font-semibold text-brand-green-dark">Cashier</span>{" "}
          can only take orders and print receipts.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-brand-green-dark text-white">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Username</th>
              <th className="text-left px-4 py-3 font-semibold">Display Name</th>
              <th className="text-left px-4 py-3 font-semibold">Password</th>
              <th className="text-left px-4 py-3 font-semibold w-32">Role</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u, i) => (
              <tr key={u.username + i} className="hover:bg-brand-cream/40">
                <td className="px-4 py-2 font-mono">{u.username}</td>
                <td className="px-4 py-2">
                  <input
                    value={u.displayName || ""}
                    onChange={(e) =>
                      updateUser(i, { displayName: e.target.value })
                    }
                    className="w-full bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={u.password}
                    onChange={(e) => updateUser(i, { password: e.target.value })}
                    className="w-full font-mono bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none"
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={u.role}
                    onChange={(e) =>
                      updateUser(i, { role: e.target.value as Role })
                    }
                    className="bg-transparent border border-transparent hover:border-gray-300 focus:border-brand-green rounded px-2 py-1 focus:outline-none"
                  >
                    <option value="cashier">Cashier</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => deleteUser(i)}
                    className="text-red-600 hover:text-red-800 text-xs font-semibold"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// CloudPanel
// ============================================================
function CloudPanel({
  cloud,
  setCloud,
  cloudStatus,
  backupNow,
  exportJSON,
  restoreJSON,
}: {
  cloud: CloudSettings;
  setCloud: React.Dispatch<React.SetStateAction<CloudSettings>>;
  cloudStatus: CloudStatus;
  backupNow: () => Promise<string>;
  exportJSON: () => void;
  restoreJSON: (file: File) => void;
}) {
  const [draft, setDraft] = useState(cloud);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDraft(cloud), [cloud]);

  const fileRef = useRef<HTMLInputElement>(null);

  const saveCloud = () => {
    setCloud(draft);
    alert("Cloud settings saved.");
  };

  const doBackup = async () => {
    setBusy(true);
    setMsg(null);
    const m = await backupNow();
    setMsg(m);
    setBusy(false);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) restoreJSON(f);
    if (fileRef.current) fileRef.current.value = "";
  };

  const statusBadge: Record<CloudStatus, { color: string; label: string }> = {
    synced: { color: "bg-green-100 text-green-800", label: "🟢 Cloud Synced" },
    syncing: { color: "bg-yellow-100 text-yellow-800", label: "🟡 Syncing…" },
    offline: { color: "bg-yellow-100 text-yellow-800", label: "🟡 Offline" },
    error: { color: "bg-red-100 text-red-800", label: "🔴 Sync Failed" },
    disabled: { color: "bg-gray-100 text-gray-700", label: "⚪ Cloud Off" },
  };
  const sb = statusBadge[cloudStatus];

  return (
    <div className="space-y-4">
      {/* Status + actions */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold text-brand-green-dark">
              Cloud Backup Status
            </h2>
            <div className="text-xs text-gray-500 mt-0.5">
              Last backup:{" "}
              {cloud.lastBackupAt
                ? new Date(cloud.lastBackupAt).toLocaleString()
                : "Never"}
            </div>
          </div>
          <span
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${sb.color}`}
          >
            {sb.label}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={doBackup}
            disabled={busy}
            className="px-4 py-2 bg-brand-green text-white rounded-md text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50"
          >
            {busy ? "Backing up…" : "☁ Backup Now"}
          </button>
          <button
            onClick={exportJSON}
            className="px-4 py-2 bg-brand-gold text-brand-green-dark rounded-md text-sm font-semibold hover:brightness-95"
          >
            ⬇ Export All (JSON)
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-white border border-brand-green-dark text-brand-green-dark rounded-md text-sm font-semibold hover:bg-brand-cream"
          >
            ⬆ Restore from Backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onFile}
          />
        </div>
        {msg && (
          <div className="mt-3 text-sm text-brand-green-dark bg-brand-cream border border-brand-gold rounded-md px-3 py-2">
            {msg}
          </div>
        )}
      </div>

      {/* Firebase config */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-brand-green-dark">
            Firebase Firestore Configuration
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
              className="w-4 h-4 accent-brand-green"
            />
            <span className="font-semibold text-brand-green-dark">
              Enable Cloud Sync
            </span>
          </label>
        </div>
        <p className="text-xs text-gray-600">
          Create a free Firebase project at{" "}
          <span className="font-mono text-brand-green-dark">
            console.firebase.google.com
          </span>
          , add a Web App, then paste the config values below. Make sure to
          enable Firestore Database and add a permissive rule for testing
          (or proper auth rules for production).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            [
              ["apiKey", "API Key"],
              ["authDomain", "Auth Domain"],
              ["projectId", "Project ID"],
              ["storageBucket", "Storage Bucket"],
              ["messagingSenderId", "Messaging Sender ID"],
              ["appId", "App ID"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                value={(draft.config as any)[k] || ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    config: { ...draft.config, [k]: e.target.value },
                  })
                }
                placeholder={k}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:border-brand-green"
              />
            </Field>
          ))}
        </div>
        <Field label="Firestore Collection Name">
          <input
            value={draft.collection}
            onChange={(e) => setDraft({ ...draft, collection: e.target.value })}
            placeholder="albarakah_pos"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:border-brand-green"
          />
        </Field>
        <button
          onClick={saveCloud}
          className="w-full py-2.5 bg-brand-green text-white font-bold rounded-md hover:bg-brand-green-dark"
        >
          Save Cloud Settings
        </button>
        <div className="text-[11px] text-gray-500 leading-relaxed">
          <span className="font-semibold">How it works:</span> When enabled and
          online, every new order is auto-synced to Firestore as a document.
          The status dot in the header shows live sync state. If offline,
          orders save locally and you can press <em>Backup Now</em> later.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Reports (admin only) — Daily / Weekly / Monthly + chart
// ============================================================
function Reports({
  orders,
  settings,
}: {
  orders: Order[];
  settings: Settings;
}) {
  type Period = "daily" | "weekly" | "monthly" | "custom";
  const [period, setPeriod] = useState<Period>("daily");
  const [from, setFrom] = useState<string>(() =>
    new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );

  // Compute period range
  const range = useMemo(() => {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    if (period === "daily") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (period === "weekly") {
      const day = start.getDay() === 0 ? 6 : start.getDay() - 1; // week starts Mon
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (period === "monthly") {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      start = new Date(from + "T00:00:00");
      end = new Date(to + "T23:59:59.999");
    }
    return { start, end };
  }, [period, from, to]);

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        const d = new Date(o.date);
        return d >= range.start && d <= range.end;
      }),
    [orders, range],
  );

  const totalRevenue = filtered.reduce((s, o) => s + o.total, 0);
  const totalVat = filtered.reduce((s, o) => s + o.vat, 0);
  const baseAmount = totalRevenue - totalVat;
  const orderCount = filtered.length;
  const avgOrder = orderCount ? totalRevenue / orderCount : 0;

  // Daily series for chart
  const seriesMap = new Map<
    string,
    { date: string; sales: number; vat: number; orders: number }
  >();
  // Seed with all days in range
  const days: string[] = [];
  const cur = new Date(range.start);
  while (cur <= range.end && days.length < 366) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  days.forEach((d) =>
    seriesMap.set(d, { date: d, sales: 0, vat: 0, orders: 0 }),
  );
  filtered.forEach((o) => {
    const d = new Date(o.date).toISOString().slice(0, 10);
    const cur = seriesMap.get(d) || { date: d, sales: 0, vat: 0, orders: 0 };
    cur.sales += o.total;
    cur.vat += o.vat;
    cur.orders += 1;
    seriesMap.set(d, cur);
  });
  const chartData = [...seriesMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Best sellers
  const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
  filtered.forEach((o) =>
    o.items.forEach((i) => {
      const cur = itemMap.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      cur.qty += i.qty;
      cur.revenue += i.price * i.qty;
      itemMap.set(i.name, cur);
    }),
  );
  const bestSellers = [...itemMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  // Peak hours
  const hourMap = new Array(24).fill(0).map((_, h) => ({
    hour: h,
    label: `${h.toString().padStart(2, "0")}:00`,
    orders: 0,
    sales: 0,
  }));
  filtered.forEach((o) => {
    const h = new Date(o.date).getHours();
    hourMap[h].orders += 1;
    hourMap[h].sales += o.total;
  });
  const peakHours = [...hourMap]
    .filter((h) => h.orders > 0)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 6);

  // Range labels
  const rangeLabel = (() => {
    const opts: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "long",
      year: "numeric",
    };
    if (period === "daily")
      return range.start.toLocaleDateString(undefined, opts);
    if (period === "monthly")
      return range.start.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
    return `${range.start.toLocaleDateString(undefined, opts)} — ${range.end.toLocaleDateString(undefined, opts)}`;
  })();

  const periods: { id: Period; label: string; icon: string }[] = [
    { id: "daily", label: "Daily", icon: "📅" },
    { id: "weekly", label: "Weekly", icon: "📆" },
    { id: "monthly", label: "Monthly", icon: "🗓️" },
    { id: "custom", label: "Custom Range", icon: "🎯" },
  ];

  const printReport = () => window.print();

  const exportPDF = () => {
    // Use browser print-to-PDF
    window.print();
  };

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div id="vat-report" className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-green-dark">
              VAT Reports
            </h1>
            <p className="text-sm text-gray-500">
              ZATCA-ready tax reports · {settings.restaurantName}
              {settings.restaurantNameAr && (
                <span dir="rtl" className="mx-2">
                  · {settings.restaurantNameAr}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap no-print">
            <button
              onClick={printReport}
              className="px-3 py-1.5 text-sm rounded-md bg-brand-green-dark text-white font-semibold hover:bg-brand-green"
            >
              🖨 Print VAT Report
            </button>
            <button
              onClick={exportPDF}
              className="px-3 py-1.5 text-sm rounded-md bg-brand-gold text-brand-green-dark font-semibold hover:brightness-95"
            >
              📄 Export as PDF
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex gap-2 flex-wrap no-print">
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === p.id
                  ? "bg-brand-green text-white"
                  : "bg-white border border-gray-200 text-gray-700 hover:border-brand-green"
              }`}
            >
              {p.icon} {p.label}
            </button>
          ))}
          {period === "custom" && (
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-3 py-1.5">
              <span className="text-xs text-gray-600">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1"
              />
              <span className="text-xs text-gray-600">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1"
              />
            </div>
          )}
        </div>

        {/* ZATCA-style summary card */}
        <div className="bg-white border-2 border-brand-gold rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-xs uppercase tracking-widest text-brand-gold font-bold">
                {period === "daily"
                  ? "Daily Report"
                  : period === "weekly"
                    ? "Weekly Report"
                    : period === "monthly"
                      ? "Monthly Report"
                      : "Custom Report"}
              </div>
              <div className="text-lg font-bold text-brand-green-dark">
                {rangeLabel}
              </div>
              <div
                dir="rtl"
                className="text-sm font-semibold text-brand-green-dark/70"
              >
                تقرير ضريبة القيمة المضافة
              </div>
            </div>
            {settings.vatNumber && (
              <div className="text-right text-xs">
                <div className="text-gray-500">VAT Reg. No.</div>
                <div className="font-mono font-bold text-brand-green-dark">
                  {settings.vatNumber}
                </div>
                {settings.crNumber && (
                  <>
                    <div className="text-gray-500 mt-1">CR No.</div>
                    <div className="font-mono font-bold text-brand-green-dark">
                      {settings.crNumber}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="border-t-2 border-dashed border-gray-300 my-4" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <ReportStat label="Total Invoices" labelAr="إجمالي الفواتير" value={orderCount.toString()} />
            <ReportStat
              label="Total Sales (incl. VAT)"
              labelAr="إجمالي المبيعات"
              value={fmt(totalRevenue, settings.currency)}
              accent
            />
            <ReportStat
              label="Base Amount (excl. VAT)"
              labelAr="المبلغ الأساسي"
              value={fmt(baseAmount, settings.currency)}
            />
            <ReportStat
              label={`VAT ${settings.vatPercent}%`}
              labelAr="ضريبة القيمة المضافة"
              value={fmt(totalVat, settings.currency)}
            />
            <ReportStat
              label="Avg Order Value"
              labelAr="متوسط الطلب"
              value={fmt(avgOrder, settings.currency)}
            />
          </div>
          <div className="mt-4 border-t-2 border-double border-gray-700 pt-3 flex justify-between items-baseline">
            <span className="text-sm font-bold text-brand-green-dark">
              NET REVENUE / صافي الإيرادات
            </span>
            <span className="text-xl font-bold text-brand-green-dark">
              {fmt(baseAmount, settings.currency)}
            </span>
          </div>
        </div>

        {/* Sales chart */}
        {chartData.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold text-brand-green-dark mb-3">
              Sales Trend
            </h2>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => d.slice(5)}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} />
                  <Tooltip
                    formatter={(v: any) => fmt(Number(v), settings.currency)}
                  />
                  <Legend />
                  <Bar
                    dataKey="sales"
                    name="Total Sales"
                    fill="#0f4c3a"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="vat"
                    name="VAT"
                    fill="#c9a961"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {/* Best sellers */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold text-brand-green-dark mb-3">
              Best Selling Items
            </h2>
            {bestSellers.length === 0 ? (
              <div className="text-sm text-gray-400">No sales in this period.</div>
            ) : (
              <ul className="space-y-2">
                {bestSellers.map((it, i) => {
                  const max = bestSellers[0]?.qty || 1;
                  const pct = (it.qty / max) * 100;
                  return (
                    <li key={it.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-900">
                          <span className="text-brand-gold mr-2">
                            #{i + 1}
                          </span>
                          {it.name}
                        </span>
                        <span className="text-gray-700">
                          {it.qty} × ·{" "}
                          <span className="font-semibold text-brand-green-dark">
                            {fmt(it.revenue, settings.currency)}
                          </span>
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-green rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Peak hours */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold text-brand-green-dark mb-3">
              Peak Hours
            </h2>
            {peakHours.length === 0 ? (
              <div className="text-sm text-gray-400">No sales in this period.</div>
            ) : (
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={hourMap}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" fontSize={10} interval={2} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="orders"
                      stroke="#0f4c3a"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#c9a961" }}
                      name="Orders"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {peakHours.length > 0 && (
              <div className="mt-2 text-xs text-gray-600">
                Busiest:{" "}
                {peakHours.slice(0, 3).map((h, i) => (
                  <span key={h.hour}>
                    <span className="font-semibold text-brand-green-dark">
                      {h.label}
                    </span>{" "}
                    ({h.orders})
                    {i < 2 && peakHours[i + 1] ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ZATCA filing footer */}
        <div className="bg-brand-cream border border-brand-gold rounded-lg p-4 text-sm">
          <div className="font-bold text-brand-green-dark mb-1">
            ZATCA Compliance Note
          </div>
          <div className="text-xs text-brand-green-dark/80 leading-relaxed">
            This report uses VAT-inclusive pricing. Base Amount is calculated
            as Total ÷ (1 + VAT rate). Use these figures for your VAT return
            (Form 8) filing on the ZATCA portal. Print or export as PDF and
            keep records for at least 6 years per Saudi tax law.
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportStat({
  label,
  labelAr,
  value,
  accent,
}: {
  label: string;
  labelAr?: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-3 border ${
        accent
          ? "bg-brand-green-dark border-brand-gold text-white"
          : "bg-brand-cream border-brand-gold/40"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold ${
          accent ? "text-brand-gold" : "text-gray-600"
        }`}
      >
        {label}
      </div>
      {labelAr && (
        <div
          dir="rtl"
          className={`text-[10px] font-semibold ${
            accent ? "text-white/70" : "text-gray-500"
          }`}
        >
          {labelAr}
        </div>
      )}
      <div
        className={`text-base md:text-lg font-bold mt-1 ${
          accent ? "text-white" : "text-brand-green-dark"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
