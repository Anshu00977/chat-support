import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { signAdminToken } from "../utils/jwt";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin || !admin.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signAdminToken({ adminId: admin.id, role: admin.role });
  res.json({
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ admin: req.admin });
});
