export function freeSignupEnabled() {
  return process.env.PUBLIC_FREE_SIGNUP === "on" && process.env.FLOCKENCE_ORIYA_ONLY !== "on";
}
