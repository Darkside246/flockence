export function validSlots(slots) {
  return Array.isArray(slots) && slots.length === 4 &&
    slots.every(n => n === null || (typeof n === "string" && n.trim() && n.length <= 200)) &&
    new Set(slots.filter(Boolean)).size === slots.filter(Boolean).length;
}

export function visibleSlots(slots, cameras) {
  const available = cameras.filter(name => !slots.includes(name));
  return slots.map(name => name ?? available.shift() ?? null);
}
