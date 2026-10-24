import dotenv from "dotenv"
import { fileURLToPath } from "node:url"

export function loadEnvironment() {
  return dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) })
}
