import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const scrypt = promisify(scryptCallback);
const envPath = resolve(process.cwd(), ".env");
const farmId = process.env.FARM_ID || "default-farm";
const email = (process.env.FLOCKENCE_OWNER_EMAIL || "owner@flockence.local").trim().toLowerCase();
const name = (process.env.FLOCKENCE_OWNER_NAME || "Flockence Owner").trim();

function fail(message) {
  console.error("\nBootstrap stopped: " + message);
  process.exitCode = 1;
}

function ensureLocalDatabase() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("This bootstrap is for local development only.");
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is missing. Run with: node --env-file=.env scripts/bootstrap-local-owner.mjs");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)
      || url.port !== "54329"
      || database !== "flockence_dev") {
    throw new Error("Refusing to run: DATABASE_URL must target local 127.0.0.1:54329/flockence_dev.");
  }
}

function ensureAuthSecret() {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 && !/^(replace-with|change-me|your-secret)/i.test(process.env.AUTH_SECRET)) return;
  const nextSecret = randomBytes(48).toString("base64url");
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*AUTH_SECRET\s*=/.test(line));
  const replacement = "AUTH_SECRET=\"" + nextSecret + "\"";
  if (index >= 0) lines[index] = replacement;
  else lines.push(replacement);
  writeFileSync(envPath, lines.join("\n").replace(/\n*$/, "\n"), { encoding: "utf8" });
  process.env.AUTH_SECRET = nextSecret;
  console.log("Created a new local AUTH_SECRET in .env. Restart Next.js after this script finishes.");
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return "scrypt$" + salt.toString("base64url") + "$" + Buffer.from(derived).toString("base64url");
}

async function main() {
  ensureLocalDatabase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("FLOCKENCE_OWNER_EMAIL is not a valid email address.");
  if (name.length < 2 || name.length > 120) throw new Error("FLOCKENCE_OWNER_NAME must be between 2 and 120 characters.");

  ensureAuthSecret();

  const password = randomBytes(32).toString("base64url") + "Aa!9";
  const hash = await passwordHash(password);
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE');

      await tx.farm.upsert({
        where: { id: farmId },
        update: {},
        create: { id: farmId, name: "Alchemy Farms", currency: "BBD" },
      });

      const users = await tx.user.findMany({
        where: { farmId },
        select: { id: true, email: true, role: true },
        take: 2,
      });

      const existing = await tx.user.findUnique({
        where: { email },
        select: { id: true, farmId: true, role: true },
      });

      let account;
      if (users.length === 0 && !existing) {
        account = await tx.user.create({
          data: { farmId, name, email, role: "OWNER" },
          select: { id: true, name: true, email: true, role: true },
        });
      } else if (
        users.length === 1
        && existing
        && existing.farmId === farmId
        && existing.role === "OWNER"
        && users[0].id === existing.id
      ) {
        account = await tx.user.findUniqueOrThrow({
          where: { id: existing.id },
          select: { id: true, name: true, email: true, role: true },
        });
      } else {
        throw new Error("The farm already has another account, or the requested email belongs to a different account. No accounts were changed. Inspect existing users before proceeding.");
      }

      await tx.setting.upsert({
        where: { farmId_key: { farmId, key: "AUTH_PASSWORD::" + account.id } },
        create: { farmId, key: "AUTH_PASSWORD::" + account.id, value: hash },
        update: { value: hash },
      });

      return account;
    });

    console.log("\nLOCAL FLOCKENCE OWNER ACCOUNT READY");
    console.log("----------------------------------");
    console.log("Name:     " + user.name);
    console.log("Email:    " + user.email);
    console.log("Role:     OWNER");
    console.log("Password: " + password);
    console.log("\nCopy the password now. It is not saved in plaintext.");
    console.log("Open http://localhost:3000/login after restarting Next.js.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/does not exist|P2021|P2022|relation .* does not exist/i.test(message)) {
    fail(message + "\nThe database schema may not be initialized. Run: npx prisma db push");
  } else {
    fail(message);
  }
});
