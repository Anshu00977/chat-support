import type { NextFunction, Request, Response } from "express";
import type { AdminRole } from "@prisma/client";
import { verifyAdminToken } from "../utils/jwt";
import { prisma } from "../prisma";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: number; role: AdminRole; name: string; email: string };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = verifyAdminToken(header.slice("Bearer ".length));
    const admin = await prisma.admin.findUnique({ where: { id: payload.adminId } });
    if (!admin || !admin.active) {
      return res.status(401).json({ error: "Account not found or deactivated" });
    }
    req.admin = { id: admin.id, role: admin.role, name: admin.name, email: admin.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
