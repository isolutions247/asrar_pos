// Thin REST client for the POS business endpoints.
// All requests are session-cookie authenticated (Replit Auth).

export interface ApiError extends Error {
  status: number;
  body?: unknown;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const err = new Error(
      `API ${res.status} on ${init.method ?? "GET"} ${path}`,
    ) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ----- Type shapes returned by the server (loosely typed; we narrow at call sites)
export interface ServerMenuItem {
  id: string;
  name: string;
  nameAr: string | null;
  categoryId: string | null;
  price: string; // numeric(12,2) as string
  image: string | null;
  description: string | null;
  available: boolean;
}

export interface ServerCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ServerCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ServerOrder {
  id: string;
  orderNumber: number;
  status: string;
  paymentMethod: string;
  cashier: string | null;
  customerId: string | null;
  customerName: string | null;
  gross: string;
  discountType: string | null;
  discountValue: string | null;
  discountAmount: string;
  total: string;
  subtotal: string;
  vatAmount: string;
  vatRate: string;
  notes: string | null;
  extras: Record<string, unknown> | null;
  createdAt: string;
  items: Array<{
    name: string;
    nameAr: string | null;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }>;
  payments: Array<{
    method: string;
    amount: string;
    reference: string | null;
  }>;
}
