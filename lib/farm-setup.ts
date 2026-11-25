import { z } from "zod";

export const barbadosParishes = [
  "Christ Church", "Saint Andrew", "Saint George", "Saint James", "Saint John",
  "Saint Joseph", "Saint Lucy", "Saint Michael", "Saint Peter", "Saint Philip", "Saint Thomas",
] as const;

export const operationLabels = {
  BROILER: "Broilers",
  LAYER: "Layers",
  BOTH: "Broilers and layers",
  OTHER: "Other poultry",
} as const;

export const housingLabels = { OPEN_SIDED_HOT: "Open-sided, hot climate", OPEN_SIDED_GOOD: "Open-sided, ventilated", CONTROLLED: "Controlled environment" } as const;
const setupPenSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80),
  housingMode: z.enum(["OPEN_SIDED_HOT", "OPEN_SIDED_GOOD", "CONTROLLED"]),
  length: z.number().positive().max(10000), width: z.number().positive().max(10000),
  unit: z.enum(["ft", "m"]), status: z.enum(["ACTIVE", "EMPTY", "MAINTENANCE", "INACTIVE"]),
  capacity: z.number().int().min(0).max(1000000).nullable(),
  occupants: z.number().int().min(0).max(1000000).nullable(),
  notes: z.string().trim().max(500),
}).strict();
export type SetupPen = z.infer<typeof setupPenSchema>;
export const metres = (dimension: number, unit: SetupPen["unit"]) => unit === "ft" ? dimension * 0.3048 : dimension;

export const farmSetupSchema = z.object({
  name: z.string().trim().max(120),
  operation: z.enum(["", "BROILER", "LAYER", "BOTH", "OTHER"]),
  country: z.string().trim().max(80),
  parish: z.string().trim().max(80),
  community: z.string().trim().max(120),
  unit: z.enum(["ft", "m"]),
  pens: z.array(setupPenSchema).max(30).default([]),
}).strict().superRefine((profile, ctx) => {
  if (profile.country.toLowerCase() === "barbados" && profile.parish
    && !barbadosParishes.some((parish) => parish === profile.parish)) {
    ctx.addIssue({ code: "custom", path: ["parish"], message: "Select a Barbados parish." });
  }
  if (new Set(profile.pens.map((pen) => pen.id)).size !== profile.pens.length
    || new Set(profile.pens.map((pen) => pen.name.toLowerCase())).size !== profile.pens.length) {
    ctx.addIssue({ code: "custom", path: ["pens"], message: "Each pen needs a unique name." });
  }
  if (!profile.country && (profile.parish || profile.community)) {
    ctx.addIssue({ code: "custom", path: ["country"], message: "Enter a country for this location." });
  }
});

export type FarmSetup = z.infer<typeof farmSetupSchema>;
