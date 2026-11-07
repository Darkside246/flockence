/** Supplier categories offered first; a farm can type its own, which is kept as typed. */
export const SUPPLIER_CATEGORIES = ["CHICKS", "FEED", "MEDICINE", "BEDDING", "EQUIPMENT", "PROCESSING", "TRANSPORT", "OTHER"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  CHICKS: "Chicks and hatcheries", FEED: "Feed dealers", MEDICINE: "Medicine and vet supplies", BEDDING: "Bedding and litter",
  EQUIPMENT: "Equipment", PROCESSING: "Processing and slaughter", TRANSPORT: "Transport", OTHER: "Other",
};
