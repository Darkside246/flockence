export const VISION_MODEL = process.env.VISION_MODEL || "gpt-5.6-luna";

export const visionCategories = [
  "PEN",
  "BIRD",
  "FLOCK",
  "DROPPINGS",
  "FEED",
  "WATER",
  "EQUIPMENT",
  "DEAD_BIRD",
  "OTHER",
] as const;

export type VisionCategory = (typeof visionCategories)[number];

export function visionPrompt(category: VisionCategory, farmContext: string) {
  return `You are Farm Vision, a visual inspection assistant for a poultry farm.

Your job is to identify visible conditions and practical things the farmer should check. You are NOT a veterinarian and must not diagnose a disease or claim a disease is confirmed from an image.

Inspection category: ${category}
Farm context: ${farmContext || "No additional context provided."}

Look for visible, actionable issues involving birds, housing, bedding, feed, water, equipment, sanitation, crowding, ventilation, heat/cold behavior, injuries, or other farm conditions appropriate to the image.

Return ONLY valid JSON with this exact shape:
{
  "summary": "one concise sentence",
  "confidence": "LOW|MEDIUM|HIGH",
  "severity": "LOW|MEDIUM|HIGH|URGENT",
  "observations": [{"title":"", "detail":"", "confidence":"LOW|MEDIUM|HIGH"}],
  "concerns": [{"title":"", "whyItMatters":""}],
  "checks": ["practical next check 1", "practical next check 2"],
  "escalate": false,
  "escalationReason": "",
  "medicalDisclaimer": "Image findings are observations only. They do not confirm disease or cause of death."
}

Do not invent measurements that are not visible. Do not identify a disease as confirmed. When something cannot be determined from the image, say so.`;
}

export function safeJson(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}
