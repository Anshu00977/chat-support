import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
};
