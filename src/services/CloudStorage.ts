/**
 * CloudStorage
 *
 * Drop-in replacement for `session.simpleStorage` that talks to the
 * cloud's REST endpoint directly. We needed this because
 * @mentra/sdk@3.0.0-alpha.4's built-in SimpleStorage derives its REST
 * base URL from the WebSocket URL via:
 *
 *   serverUrl.replace(/\/app-ws$/, "").replace(/^ws/, "http")
 *
 * which only strips the trailing `/app-ws` segment. The actual
 * WebSocket path is `/ws/miniapp/app-ws`, so the base URL ends up
 * including `/ws/miniapp` and every REST call lands at
 *
 *   /ws/miniapp/api/sdk/simple-storage/<userId>...
 *
 * Cloud returns 404 for that path (correct endpoint is
 * `/api/sdk/simple-storage/...`), so all writes silently disappear
 * after the SDK's debounced flush. Result: persisted history /
 * favorites looked like they were saving but every restart wiped
 * them.
 *
 * This wrapper rebuilds the base URL by taking everything before the
 * path of the WebSocket URL, leaving the host alone. Follows the
 * `wss://api.mentra.glass/ws/miniapp/app-ws` →
 * `https://api.mentra.glass` pattern. Fetch follows the cloud's
 * staging-redirect automatically.
 *
 * Implements the same shape as HistoryManager's StorageProvider:
 * `get(key)` and `set(key, value)`.
 *
 * Remove this file once the SDK fixes the regex upstream.
 */

import type {AppSession} from "@mentra/sdk"

type Logger = AppSession["logger"]

export class CloudStorage {
  private readonly baseUrl: string
  private readonly userId: string
  private readonly packageName: string
  private readonly apiKey: string
  private readonly logger: Logger

  constructor(args: {
    session: AppSession
    packageName: string
    apiKey: string
    logger: Logger
  }) {
    this.userId = args.session.userId
    this.packageName = args.packageName
    this.apiKey = args.apiKey
    this.logger = args.logger
    this.baseUrl = deriveBaseUrl(args.session.getServerUrl())
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.packageName}:${this.apiKey}`,
      "Content-Type": "application/json",
    }
  }

  private url(...segments: string[]): string {
    const path = segments.map(encodeURIComponent).join("/")
    return `${this.baseUrl}/api/sdk/simple-storage/${path}`
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const res = await fetch(this.url(this.userId, key), {headers: this.headers()})
      if (res.status === 404) return undefined
      if (!res.ok) {
        this.logger.warn({status: res.status, key}, "CloudStorage.get failed")
        return undefined
      }
      const body = (await res.json()) as {value?: string} | string
      // The cloud may return {value: "..."} or the raw string; handle both.
      if (typeof body === "string") return body
      return body?.value
    } catch (err) {
      this.logger.warn({err: (err as Error).message, key}, "CloudStorage.get threw")
      return undefined
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const res = await fetch(this.url(this.userId, key), {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({value}),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        this.logger.warn({status: res.status, key, body: body.slice(0, 200)}, "CloudStorage.set failed")
      }
    } catch (err) {
      this.logger.warn({err: (err as Error).message, key}, "CloudStorage.set threw")
    }
  }
}

/**
 * Build the REST base URL from the WebSocket URL the AppSession is
 * connected through. Takes everything before the WS path — keeps the
 * host alone — and rewrites the scheme. Defaults to prod cloud if
 * the session isn't connected yet.
 */
function deriveBaseUrl(wsUrl: string | undefined): string {
  if (!wsUrl) return "https://api.mentra.glass"
  try {
    const u = new URL(wsUrl)
    const proto = u.protocol === "wss:" ? "https:" : "http:"
    return `${proto}//${u.host}`
  } catch {
    return "https://api.mentra.glass"
  }
}
