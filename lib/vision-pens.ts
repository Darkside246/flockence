import { prisma } from "@/lib/prisma";

const penPrefixes = ["PEN::", "PENCFG::"];

function penFromSetting(row: { id: string; key: string; value: string }) {
  const parts = row.key.split("::");
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  try {
    const value = JSON.parse(row.value);
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    return name && name.length <= 120 && value.active !== false ? { id: row.id, name } : null;
  } catch {
    return null;
  }
}

export async function visionPens(id?: string) {
  const rows = await prisma.setting.findMany({
    where: { ...(id ? { id } : {}), OR: penPrefixes.map((prefix) => ({ key: { startsWith: prefix } })) },
    orderBy: { id: "asc" }, take: id ? 1 : 400, select: { id: true, key: true, value: true },
  });
  return rows.flatMap((row) => {
    const pen = penFromSetting(row);
    return pen ? [pen] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
