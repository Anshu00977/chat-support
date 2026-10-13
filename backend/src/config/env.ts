import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export interface SeedApp {
  name: string;
  shop: string;
  accessToken: string;
}

function parseSeedApps(): SeedApp[] {
  const raw = process.env.SEED_APPS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("SEED_APPS must be a JSON array");
    return parsed.map((entry, i) => {
      if (!entry.name || !entry.shop || !entry.accessToken) {
        throw new Error(`SEED_APPS[${i}] is missing name, shop, or accessToken`);
      }
      return { name: entry.name, shop: entry.shop, accessToken: entry.accessToken };
    });
  } catch (err) {
    console.error("Failed to parse SEED_APPS — skipping app auto-registration:", err);
    return [];
  }
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? "Support Bot <support@example.com>",
  },
  bootstrapSuperAdmin: {
    email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
    name: process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? "Owner",
  },
  seedApps: parseSeedApps(),
  /**
   * WishKeeper merchant support chat. Enabled only when the DB URL and shared
   * secret are both set. appUrl may also be updated at runtime by WishKeeper's
   * dev server via POST /internal/register-url (see wishkeeper.service.ts).
   */
  wishkeeper: {
    databaseUrl: process.env.WISHKEEPER_DATABASE_URL,
    appUrl: (process.env.WISHKEEPER_APP_URL ?? "").replace(/\/$/, ""),
    internalSecret: process.env.SUPPORT_INTERNAL_SECRET,
    adminDisplayName: process.env.WISHKEEPER_ADMIN_DISPLAY_NAME ?? "WishKeeper Support",
  },
};
