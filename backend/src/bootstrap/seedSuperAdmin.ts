import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { env } from "../config/env";

/** Creates the first super_admin from env vars if the Admin table is empty. */
export async function seedSuperAdminIfNeeded() {
  const count = await prisma.admin.count();
  if (count > 0) return;

  const { email, password, name } = env.bootstrapSuperAdmin;
  if (!email || !password) {
    console.warn(
      "No admins exist yet and BOOTSTRAP_SUPER_ADMIN_EMAIL/PASSWORD are not set — set them in .env and restart."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.admin.create({
    data: { name, email: email.toLowerCase(), passwordHash, role: "SUPER_ADMIN" },
  });
  console.log(`Bootstrapped super admin: ${email}`);
}
