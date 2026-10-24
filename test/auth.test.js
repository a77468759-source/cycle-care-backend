import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import { MongoMemoryServer } from "mongodb-memory-server"
import { signAccessToken } from "../src/services/authTokens.js"

process.env.JWT_ACCESS_SECRET = "test-access-secret-with-at-least-32-random-bytes"
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-with-at-least-32-random-bytes"
process.env.CLIENT_ORIGINS = "http://localhost:5173"
process.env.COOKIE_SAME_SITE = "lax"

const { default: app } = await import("../src/app.js")
const { default: User } = await import("../src/models/user.model.js")
const { default: RefreshSession } = await import("../src/models/refreshSession.model.js")
const { default: CheckIn } = await import("../src/models/checkIn.model.js")

const origin = "http://localhost:5173"
let mongoServer
let server
let baseUrl

before(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

function responseCookies(response) {
  const cookies = {}
  for (const cookie of response.headers.getSetCookie()) {
    const [nameValue] = cookie.split(";")
    const separator = nameValue.indexOf("=")
    cookies[nameValue.slice(0, separator)] = nameValue.slice(separator + 1)
  }
  return cookies
}

async function request(
  path,
  { method = "GET", body, accessToken, cookies = {}, csrfToken, requestOrigin = origin } = {},
) {
  const headers = {}
  if (requestOrigin) headers.Origin = requestOrigin
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
  if (cookieHeader) headers.Cookie = cookieHeader

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function registerUser(suffix) {
  const response = await request("/api/v1/auth/register", {
    method: "POST",
    body: { email: `${suffix}@example.test`, password: "a-strong-password-123" },
  })
  assert.equal(response.status, 201)
  return { response, data: (await response.json()).data, cookies: responseCookies(response) }
}

async function loginUser(email) {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password: "a-strong-password-123" },
  })
  assert.equal(response.status, 200)
  const data = (await response.json()).data
  assert.ok(data.accessToken)
  return data
}

test("registration hashes passwords and returns only short-lived access tokens", async () => {
  const { response, data, cookies } = await registerUser("hashed")
  assert.equal(data.user.email, "hashed@example.test")
  assert.equal("refreshToken" in data, false)
  assert.equal("password" in data.user, false)
  assert.equal(cookies.cyclecare_refresh_token.length > 0, true)
  assert.equal(cookies.cyclecare_csrf_token, data.csrfToken)

  const refreshCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("cyclecare_refresh_token="))
  assert.match(refreshCookie, /HttpOnly/i)
  assert.match(refreshCookie, /SameSite=Lax/i)

  const user = await User.findOne({ email: "hashed@example.test" }).select("+passwordHash")
  assert.notEqual(user.passwordHash, "a-strong-password-123")
  assert.equal(await bcrypt.compare("a-strong-password-123", user.passwordHash), true)

  const loginResponse = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email: "HASHED@example.test", password: "a-strong-password-123" },
  })
  assert.equal(loginResponse.status, 200)
  const loginData = (await loginResponse.json()).data
  assert.ok(loginData.accessToken)
  const meResponse = await request("/api/v1/auth/me", { accessToken: loginData.accessToken })
  assert.equal(meResponse.status, 200)
  assert.equal((await meResponse.json()).data.user.email, "hashed@example.test")
})

test("expired access tokens are rejected", async () => {
  const expiredToken = jwt.sign(
    { tokenType: "access" },
    process.env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      subject: new mongoose.Types.ObjectId().toString(),
      issuer: "cyclecare-api",
      audience: "cyclecare-client",
      expiresIn: -1,
    },
  )
  const response = await request("/api/v1/auth/me", { accessToken: expiredToken })
  assert.equal(response.status, 401)
})

test("check-ins reject unauthenticated requests", async () => {
  const response = await request("/api/v1/check-ins")
  assert.equal(response.status, 401)
})

test("AI chat requires authentication, an allowed origin, CSRF, and a bounded message", async () => {
  const path = "/api/v1/ai/chat"
  const unauthenticated = await request(path, {
    method: "POST",
    body: { message: "What can help with period cramps?" },
  })
  assert.equal(unauthenticated.status, 401)

  const csrfToken = "test-csrf-token"
  const baseOptions = {
    method: "POST",
    accessToken: signAccessToken(new mongoose.Types.ObjectId().toString()),
    cookies: { cyclecare_csrf_token: csrfToken },
    body: { message: "What can help with period cramps?" },
  }

  const rejectedOrigin = await request(path, {
    ...baseOptions,
    requestOrigin: "https://untrusted.example",
    csrfToken,
  })
  assert.equal(rejectedOrigin.status, 403)

  const rejectedCsrf = await request(path, baseOptions)
  assert.equal(rejectedCsrf.status, 403)

  const rejectedExtraField = await request(path, {
    ...baseOptions,
    csrfToken,
    body: { message: "What can help with period cramps?", checkIns: [] },
  })
  assert.equal(rejectedExtraField.status, 400)

  const rejectedLongMessage = await request(path, {
    ...baseOptions,
    csrfToken,
    body: { message: "a".repeat(4001) },
  })
  assert.equal(rejectedLongMessage.status, 400)
})

test("registration and refresh reject untrusted origins and invalid CSRF tokens", async () => {
  const rejectedRegistration = await request("/api/v1/auth/register", {
    method: "POST",
    requestOrigin: "https://untrusted.example",
    body: { email: "blocked@example.test", password: "a-strong-password-123" },
  })
  assert.equal(rejectedRegistration.status, 403)

  const { data, cookies } = await registerUser("csrf")
  const rejectedRefresh = await request("/api/v1/auth/refresh", {
    method: "POST",
    cookies,
    csrfToken: "incorrect",
  })
  assert.equal(rejectedRefresh.status, 403)
  assert.ok(data.accessToken)
})

test("refresh rotates tokens and reuse of the prior token revokes the session", async () => {
  const { data, cookies } = await registerUser("rotation")
  const refreshPath = "/api/v1/auth/refresh"
  const firstRefreshToken = cookies.cyclecare_refresh_token
  const firstResponse = await request(refreshPath, {
    method: "POST",
    cookies,
    csrfToken: data.csrfToken,
  })
  assert.equal(firstResponse.status, 200)
  const rotatedCookies = responseCookies(firstResponse)
  assert.notEqual(rotatedCookies.cyclecare_refresh_token, firstRefreshToken)

  const reuseResponse = await request(refreshPath, {
    method: "POST",
    cookies,
    csrfToken: data.csrfToken,
  })
  assert.equal(reuseResponse.status, 401)

  const currentResponse = await request(refreshPath, {
    method: "POST",
    cookies: { ...cookies, ...rotatedCookies },
    csrfToken: data.csrfToken,
  })
  assert.equal(currentResponse.status, 401)
  assert.equal(await RefreshSession.countDocuments({ revokedAt: { $ne: null } }), 1)
})

test("logout revokes the refresh session", async () => {
  const { data, cookies } = await registerUser("logout")
  const response = await request("/api/v1/auth/logout", {
    method: "POST",
    cookies,
    csrfToken: data.csrfToken,
  })
  assert.equal(response.status, 200)

  const refreshResponse = await request("/api/v1/auth/refresh", {
    method: "POST",
    cookies,
    csrfToken: data.csrfToken,
  })
  assert.equal(refreshResponse.status, 401)
})

test("check-in routes isolate users across reads, lists, updates, deletes, and unauthenticated requests", async () => {
  await registerUser("owner")
  await registerUser("other")
  const userA = await loginUser("owner@example.test")
  const userB = await loginUser("other@example.test")

  const createA = await request("/api/v1/check-ins", {
    method: "POST",
    accessToken: userA.accessToken,
    body: { symptoms: ["Cramps"], severity: 4, note: "User A private note." },
  })
  assert.equal(createA.status, 201)
  const checkInAId = (await createA.json()).data.checkIn.id

  const createB = await request("/api/v1/check-ins", {
    method: "POST",
    accessToken: userB.accessToken,
    body: { mood: "Energetic", symptoms: ["Acne", "Other"], severity: 3, note: "User B note." },
  })
  assert.equal(createB.status, 201)
  const checkInBId = (await createB.json()).data.checkIn.id

  const originalA = await CheckIn.findById(checkInAId).lean()
  assert.equal(originalA.ownerId.toString(), userA.user.id)
  const originalASnapshot = {
    ownerId: originalA.ownerId.toString(),
    mood: originalA.mood,
    symptoms: originalA.symptoms,
    severity: originalA.severity,
    note: originalA.note,
    checkInDate: originalA.checkInDate.toISOString(),
  }

  const userBFirstPage = await request("/api/v1/check-ins?page=1&limit=1", {
    accessToken: userB.accessToken,
  })
  assert.equal(userBFirstPage.status, 200)
  const userBFirstPageData = (await userBFirstPage.json()).data
  assert.deepEqual(userBFirstPageData.checkIns.map(({ id }) => id), [checkInBId])
  assert.equal(userBFirstPageData.pagination.page, 1)
  assert.equal(userBFirstPageData.pagination.limit, 1)
  assert.equal(userBFirstPageData.pagination.total, 1)
  assert.equal(userBFirstPageData.pagination.pages, 1)

  const userBSecondPage = await request("/api/v1/check-ins?page=2&limit=1", {
    accessToken: userB.accessToken,
  })
  assert.equal(userBSecondPage.status, 200)
  const userBSecondPageData = (await userBSecondPage.json()).data
  assert.deepEqual(userBSecondPageData.checkIns, [])
  assert.equal(userBSecondPageData.pagination.total, 1)
  assert.equal(userBSecondPageData.pagination.pages, 1)

  const userAList = await request("/api/v1/check-ins?page=1&limit=1", {
    accessToken: userA.accessToken,
  })
  assert.equal(userAList.status, 200)
  const userAListData = (await userAList.json()).data
  assert.deepEqual(userAListData.checkIns.map(({ id }) => id), [checkInAId])
  assert.equal(userAListData.pagination.total, 1)

  for (const [method, path, body] of [
    ["GET", `/api/v1/check-ins/${checkInAId}`],
    ["PATCH", `/api/v1/check-ins/${checkInAId}`, { mood: "Happy" }],
    ["DELETE", `/api/v1/check-ins/${checkInAId}`],
  ]) {
    const response = await request(path, {
      method,
      accessToken: userB.accessToken,
      body,
    })
    assert.equal(response.status, 404)
  }

  for (const [method, path, body] of [
    ["GET", "/api/v1/check-ins"],
    ["GET", `/api/v1/check-ins/${checkInAId}`],
    ["POST", "/api/v1/check-ins", { mood: "Calm" }],
    ["PATCH", `/api/v1/check-ins/${checkInAId}`, { mood: "Happy" }],
    ["DELETE", `/api/v1/check-ins/${checkInAId}`],
  ]) {
    const response = await request(path, { method, body })
    assert.equal(response.status, 401)
  }

  const ownRead = await request(`/api/v1/check-ins/${checkInAId}`, {
    accessToken: userA.accessToken,
  })
  assert.equal(ownRead.status, 200)
  assert.equal((await ownRead.json()).data.checkIn.id, checkInAId)

  const storedAAfterAttacks = await CheckIn.findById(checkInAId).lean()
  assert.deepEqual(
    {
      ownerId: storedAAfterAttacks.ownerId.toString(),
      mood: storedAAfterAttacks.mood,
      symptoms: storedAAfterAttacks.symptoms,
      severity: storedAAfterAttacks.severity,
      note: storedAAfterAttacks.note,
      checkInDate: storedAAfterAttacks.checkInDate.toISOString(),
    },
    originalASnapshot,
  )
  assert.equal(await CheckIn.countDocuments({}), 2)
  assert.equal(await CheckIn.exists({ _id: checkInBId, ownerId: userB.user.id }) !== null, true)
})
