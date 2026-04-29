import { Router, type IRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { runBackup } from "../lib/dailyBackup";
import { requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();

const BACKUP_DIR = path.resolve(process.cwd(), "..", "..", "backups");

router.post("/backup/run", requireAuth, async (req, res) => {
  try {
    const r = await runBackup();
    res.json({
      success: true,
      filePath: r.filePath,
      ordersCount: r.ordersCount,
      bytes: r.bytes,
    });
  } catch (err) {
    req.log.error({ err }, "Manual backup failed");
    res.status(500).json({ error: "Backup failed" });
  }
});

router.get("/backup/list", requireAuth, async (_req, res) => {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const entries = await fs.readdir(BACKUP_DIR);
    const files = await Promise.all(
      entries
        .filter((n) => n.endsWith(".json"))
        .map(async (name) => {
          const full = path.join(BACKUP_DIR, name);
          const stat = await fs.stat(full);
          return { name, size: stat.size, mtime: stat.mtime };
        }),
    );
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: "Cannot list backups", message: String(err) });
  }
});

router.get("/backup/download/:name", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (
    !name ||
    Array.isArray(name) ||
    name.includes("/") ||
    name.includes("..")
  ) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const full = path.join(BACKUP_DIR, name);
  try {
    const text = await fs.readFile(full, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(text);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

export default router;
