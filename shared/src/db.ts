import "./env";
import { PrismaClient } from "@prisma/client";

declare global {
    // eslint-disable-next-line no-var
    var judgePrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.judgePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.judgePrisma = prisma;
