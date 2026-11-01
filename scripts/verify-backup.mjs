import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, umask } from "node:fs";
import path from "node:path";

umask(0o077);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required.");
  return value;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(command + " exited with code " + code)));
  });
}

function databaseIdentity(raw, name) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(name + " must be a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(name + " must use the PostgreSQL protocol.");
  return { host: url.hostname.toLowerCase(), port: url.port || "5432", database: decodeURIComponent(url.pathname.replace(/^\//, "")) };
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const sourceIdentity = databaseIdentity(databaseUrl, "DATABASE_URL");
  const backupDir = path.resolve(process.env.BACKUP_DIR || "./backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, "chicken-op-" + timestamp + ".dump");

  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", backupFile, databaseUrl]);
  if (!existsSync(backupFile)) throw new Error("pg_dump reported success but the backup file was not created.");
  chmodSync(backupFile, 0o600);
  await run("pg_restore", ["--list", backupFile]);

  const restoreUrl = process.env.RESTORE_DATABASE_URL?.trim();
  if (restoreUrl) {
    if (process.env.RESTORE_CONFIRM !== "YES") {
      throw new Error("RESTORE_DATABASE_URL was supplied. Set RESTORE_CONFIRM=YES only after verifying it points to an empty, disposable database.");
    }
    const restoreIdentity = databaseIdentity(restoreUrl, "RESTORE_DATABASE_URL");
    const sameDatabase = sourceIdentity.host === restoreIdentity.host
      && sourceIdentity.port === restoreIdentity.port
      && sourceIdentity.database === restoreIdentity.database;
    if (sameDatabase) throw new Error("Refusing to restore into the same host, port and database as DATABASE_URL.");

    console.log("Restoring the backup into the separate verification database...");
    await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", restoreUrl, backupFile]);
    await run("psql", [
      restoreUrl,
      "-v", "ON_ERROR_STOP=1",
      "-c",
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Farm') THEN RAISE EXCEPTION 'Farm table was not restored'; END IF; END $$;",
    ]);
    console.log("Full restore verification completed.");
  } else {
    console.log("Backup archive and table-of-contents verification completed.");
    console.log("Set RESTORE_DATABASE_URL to a separate empty database and RESTORE_CONFIRM=YES for a full restore test.");
  }

  console.log("Backup:", backupFile);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
