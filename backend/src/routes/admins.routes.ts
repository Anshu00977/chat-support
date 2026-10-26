import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const adminsRouter = Router();

adminsRouter.use(requireAuth);

// Any authenticated admin can see the list (needed for the "transfer to" picker).
adminsRouter.get("/", async (_req, res) => {
  const admins = await prisma.admin.findMany({
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ admins });
});

// Only super_admin can create new admins.
adminsRouter.post("/", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: "ADMIN" | "SUPER_ADMIN";
  };

  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const existing = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return res.status(409).json({ error: "An admin with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.admin.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN",
    },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });

  res.status(201).json({ admin });
});

// Only super_admin can promote/demote.
adminsRouter.patch("/:id/role", requireRole("SUPER_ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body as { role?: "ADMIN" | "SUPER_ADMIN" };
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return res.status(400).json({ error: "role must be ADMIN or SUPER_ADMIN" });
  }

  const admin = await prisma.admin.update({
    where: { id },
    data: { role },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  res.json({ admin });
});

// Any authenticated admin can change their own password (not someone else's).
adminsRouter.patch("/me/password", async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }

  const admin = await prisma.admin.findUnique({ where: { id: req.admin!.id } });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } });

  res.json({ ok: true });
});

// Only super_admin can deactivate/reactivate.
adminsRouter.patch("/:id/active", requireRole("SUPER_ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { active } = req.body as { active?: boolean };
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "active must be a boolean" });
  }

  if (req.admin!.id === id && !active) {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }

  const admin = await prisma.admin.update({
    where: { id },
    data: { active },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  res.json({ admin });
});
