export const farmPreferenceKeys = [
  "default_feed_bag_price",
  "default_chick_cost",
  "default_slaughter_cost",
  "weather_location_name",
  "weather_latitude",
  "weather_longitude",
];

const keys = new Set(farmPreferenceKeys);

export function isFarmPreferenceKey(key: unknown): key is string {
  return typeof key === "string" && keys.has(key);
}
