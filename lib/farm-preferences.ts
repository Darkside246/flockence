export const farmPreferenceKeys = [
  "default_feed_bag_price",
  "default_chick_cost",
  "default_slaughter_cost",
  "weather_location_name",
  "weather_latitude",
  "weather_longitude",
  // Feed defaults: the farm's usual bag size (kg), how feed is usually counted out (BAG, KG, LB or MEASURE),
  // the feed-in-store warning level in days, and the usual breed pre-filled on new flocks.
  "default_bag_kg",
  "feed_record_method",
  "feed_low_days",
  "default_breed",
];

const keys = new Set(farmPreferenceKeys);

export function isFarmPreferenceKey(key: unknown): key is string {
  return typeof key === "string" && keys.has(key);
}
