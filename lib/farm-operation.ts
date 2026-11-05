export const operationLabels = {
  broilers: "Broilers",
  layers: "Layers",
  both: "Both broilers and layers",
} as const;

export type FarmOperation = keyof typeof operationLabels;
export const operationKey = "poultry_operation";
export function isOperation(value: unknown): value is FarmOperation {
  return typeof value === "string" && Object.hasOwn(operationLabels, value);
}
export function showDestination(path: string, operation?: FarmOperation | null) {
  if (operation === "broilers") return !path.startsWith("/layers");
  if (operation === "layers") return path !== "/planning";
  return true;
}
