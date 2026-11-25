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

export const farmSetupSchema = z.object({
  name: z.string().trim().max(120),
  operation: z.enum(["", "BROILER", "LAYER", "BOTH", "OTHER"]),
  country: z.string().trim().max(80),
  parish: z.string().trim().max(80),
  community: z.string().trim().max(120),
  unit: z.enum(["ft", "m"]),
}).strict().superRefine((profile, ctx) => {
  if (profile.country.toLowerCase() === "barbados" && profile.parish
    && !barbadosParishes.some((parish) => parish === profile.parish)) {
    ctx.addIssue({ code: "custom", path: ["parish"], message: "Select a Barbados parish." });
  }
  if (!profile.country && (profile.parish || profile.community)) {
    ctx.addIssue({ code: "custom", path: ["country"], message: "Enter a country for this location." });
  }
});

export type FarmSetup = z.infer<typeof farmSetupSchema>;
