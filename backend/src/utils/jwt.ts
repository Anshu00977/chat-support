import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AdminRole } from "@prisma/client";

export interface AuthTokenPayload {
  adminId: number;
  role: AdminRole;
}

export function signAdminToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyAdminToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
}
