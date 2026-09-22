import { PrismaClient } from "@prisma/client";

/**
 * Eén gedeelde PrismaClient voor de hele applicatie (SPEC §7).
 *
 * In development vervangt Next.js bij hot reload de modulecache, waardoor elke reload
 * een nieuwe PrismaClient — en dus een nieuwe connectiepool — zou aanmaken tot Postgres
 * de verbindingen weigert. Daarom bewaren we de client op `globalThis`, die een hot
 * reload wél overleeft. In productie start het proces één keer, dus daar is de globale
 * cache niet nodig.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
