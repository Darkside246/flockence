import type { Prisma, Setting } from "@prisma/client";
import { prisma } from "./prisma";

export const penKey = "FARM_PEN::";
const migrated = "FARM_PENS_IMPORTED_V1";

export function withFarmPens<T>(farmId: string, operation: (tx: Prisma.TransactionClient, pens: Setting[]) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM "Farm" WHERE id = ${farmId} FOR UPDATE`;
    const marker = await tx.setting.findUnique({where:{farmId_key:{farmId,key:migrated}}});
    if (!marker) {
      const old = await tx.setting.findMany({ where:{farmId,OR:[{key:{startsWith:"PENCFG::"}},{key:{startsWith:"PEN::"}}]}, orderBy:{key:"asc"} });
      const names = new Set<string>(), ids = new Set<string>(), signatures = new Set<string>();
      for (const row of old) {
        const parts = row.key.split("::");
        if (parts.length !== 3) continue; // Skip legacy name indexes.
        let data;
        try { data = JSON.parse(row.value); } catch { continue; }
        if (!data || typeof data.name !== "string" || !data.name.trim()) continue;
        const signature = JSON.stringify({...data,name:data.name.trim().toLowerCase()}, Object.keys(data).sort());
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        const base = data.name.trim();
        let name = base;
        for (let n=2; names.has(name.toLowerCase()); n++) name = `${base} (${n})`;
        const id = ids.has(parts[2]) ? crypto.randomUUID() : parts[2];
        names.add(name.toLowerCase()); ids.add(id);
        await tx.setting.create({data:{farmId,key:penKey+id,value:JSON.stringify({...data,name})}});
      }
      await tx.setting.create({data:{farmId,key:migrated,value:"1"}});
    }
    const rows = await tx.setting.findMany({where:{farmId,key:{startsWith:penKey}},orderBy:{updatedAt:"desc"}});
    return operation(tx,rows);
  });
}
