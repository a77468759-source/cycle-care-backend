export function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function isAllowedOrigin(origin) {
  return getAllowedOrigins().includes(origin)
}
