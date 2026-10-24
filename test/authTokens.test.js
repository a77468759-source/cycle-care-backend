import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { getJwtSecrets } from "../src/services/authTokens.js"
import { loadEnvironment } from "../src/config/loadEnv.js"

function withJwtSecrets(accessSecret, refreshSecret, callback) {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET

  if (accessSecret === undefined) delete process.env.JWT_ACCESS_SECRET
  else process.env.JWT_ACCESS_SECRET = accessSecret
  if (refreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET
  else process.env.JWT_REFRESH_SECRET = refreshSecret

  try {
    callback()
  } finally {
    if (originalAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET
    else process.env.JWT_ACCESS_SECRET = originalAccessSecret
    if (originalRefreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET
    else process.env.JWT_REFRESH_SECRET = originalRefreshSecret
  }
}

test("JWT secrets are required and must meet the minimum length", () => {
  withJwtSecrets(undefined, undefined, () => {
    assert.throws(getJwtSecrets, { statusCode: 503 })
  })
  withJwtSecrets("a".repeat(32), undefined, () => {
    assert.throws(getJwtSecrets, { statusCode: 503 })
  })
  withJwtSecrets("short", "another-short", () => {
    assert.throws(getJwtSecrets, { statusCode: 503 })
  })
})

test("JWT secrets reject insecure defaults and identical values", () => {
  withJwtSecrets(
    "replace-with-a-random-secret-at-least-32-bytes-long",
    "a-different-secure-secret-with-at-least-32-bytes",
    () => assert.throws(getJwtSecrets, { statusCode: 503 }),
  )
  withJwtSecrets("a".repeat(32), "a".repeat(32), () => {
    assert.throws(getJwtSecrets, { statusCode: 503 })
  })
})

test("JWT secrets accept distinct values of at least 32 bytes", () => {
  const accessSecret = "test-access-secret-with-at-least-32-random-bytes"
  const refreshSecret = "test-refresh-secret-with-at-least-32-random-bytes"

  withJwtSecrets(accessSecret, refreshSecret, () => {
    assert.deepEqual(getJwtSecrets(), { accessSecret, refreshSecret })
  })
})

test("backend .env loads from its own directory regardless of the working directory", async () => {
  const originalCwd = process.cwd()
  const originalEnv = { ...process.env }
  const temporaryCwd = await mkdtemp(path.join(tmpdir(), "cyclecare-env-test-"))

  try {
    process.chdir(temporaryCwd)
    delete process.env.JWT_ACCESS_SECRET
    delete process.env.JWT_REFRESH_SECRET

    loadEnvironment()
    assert.doesNotThrow(getJwtSecrets)
  } finally {
    process.chdir(originalCwd)
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
    await rm(temporaryCwd, { recursive: true, force: true })
  }
})
