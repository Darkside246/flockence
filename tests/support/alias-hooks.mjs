// Test-only module hooks: resolve "@/..." like tsconfig paths, adding .ts/.mjs when needed, so database tests can load
// the real TypeScript modules with node --experimental-strip-types. Nothing here is used by the app.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.mjs`, path.join(base, "index.ts")]) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
        try { if (candidate === base && !/\.(m?js|ts)$/.test(base)) continue; } catch { /* keep going */ }
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts") && !path.extname(specifier)) {
    const parent = path.dirname(fileURLToPath(context.parentURL));
    const candidate = path.join(parent, `${specifier}.ts`);
    if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
  }
  return next(specifier, context);
}
