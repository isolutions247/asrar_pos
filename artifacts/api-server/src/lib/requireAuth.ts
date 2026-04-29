import { type Request, type Response, type NextFunction } from "express";

// Replit Auth removed — all API routes are accessible without a session.
// Access is still controlled by the app's own PIN/role login screen.
export function requireAuth(_req: Request, _res: Response, next: NextFunction) {
  next();
}
