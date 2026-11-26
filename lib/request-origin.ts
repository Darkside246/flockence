/** Origin supplied by the browser for changes to an account. */
export function isTrustedAppOrigin(request: Request) {
  try {
    return request.headers.get("origin") === new URL(process.env.APP_URL ?? "").origin;
  } catch {
    return false;
  }
}
