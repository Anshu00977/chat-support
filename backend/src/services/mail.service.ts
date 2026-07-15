import nodemailer from "nodemailer";
import { env } from "../config/env";
import { prisma } from "../prisma";

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

/** Notify every active admin that a conversation needs a human reply. */
export async function notifyAdminsNeedsHuman(params: {
  messageId: number;
  shop: string;
  name: string | null;
  email: string | null;
  body: string;
}) {
  const admins = await prisma.admin.findMany({
    where: { active: true },
    select: { email: true },
  });
  if (admins.length === 0) return;

  const subject = `New support message needs a human reply (${params.shop})`;
  const text = [
    `A customer message from ${params.shop} could not be answered by the bot.`,
    `From: ${params.name ?? "Anonymous"} ${params.email ? `<${params.email}>` : ""}`,
    "",
    params.body,
    "",
    `Open the dashboard and claim conversation #${params.messageId} to reply.`,
  ].join("\n");

  try {
    await transporter.sendMail({
      from: env.smtp.from,
      to: admins.map((a) => a.email).join(","),
      subject,
      text,
    });
  } catch (err) {
    console.error("Failed to send admin notification email:", err);
  }
}
