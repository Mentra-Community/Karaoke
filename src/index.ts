import { AppServer, AppSession } from "@mentra/sdk";
import { UserSession } from "./UserSession";
import { setupWebviewRoutes } from "./webview";
import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

export class KaraokeApp extends AppServer {
  private userSessions = new Map<string, UserSession>();

  private acrConfig = {
    host: process.env.ACRCLOUD_HOST || "identify-us-west-2.acrcloud.com",
    accessKey: process.env.ACRCLOUD_ACCESS_KEY || "",
    secretKey: process.env.ACRCLOUD_ACCESS_SECRET || "",
  };

  constructor() {
    super({
      packageName: process.env.PACKAGE_NAME || "com.mentra.karaoke",
      apiKey: process.env.MENTRAOS_API_KEY || "",
      port: parseInt(process.env.PORT || "3000"),
      cookieSecret:
        process.env.COOKIE_SECRET || "change-me-in-dotenv-please-32-chars-min",
      publicDir: "./public",
    });
    this.validateConfig();
    setupWebviewRoutes(this);
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const logger = session.logger.child({ service: "KaraokeApp" });
    logger.info({ sessionId, userId }, "New session started");

    const userSession = new UserSession(
      userId,
      sessionId,
      session,
      this.acrConfig,
      {
        packageName: process.env.PACKAGE_NAME || 'com.mentra.karaoke',
        apiKey: process.env.MENTRAOS_API_KEY || '',
      },
    );

    this.userSessions.set(sessionId, userSession);

    userSession.startListening();

    this.addCleanupHandler(() => {
      logger.info({ sessionId, userId }, "Cleaning up session");
      const session = this.userSessions.get(sessionId);
      if (session) {
        session.cleanup();
        this.userSessions.delete(sessionId);
      }
    });
  }

  private validateConfig(): void {
    if (!this.acrConfig.accessKey || !this.acrConfig.secretKey) {
      console.warn(
        "ACRCloud credentials not configured. Please set ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET environment variables.",
      );
    }
  }

  getActiveSessionCount(): number {
    return this.userSessions.size;
  }

  getSessionStats(sessionId: string): any {
    const session = this.userSessions.get(sessionId);
    return session ? session.getStats() : null;
  }

  getAllSessionStats(): any[] {
    return Array.from(this.userSessions.values()).map((session) =>
      session.getStats(),
    );
  }

  /**
   * Look up a UserSession by authenticated user id. The webview gets
   * `authUserId` from the SDK auth middleware; sessions are keyed by
   * sessionId internally, so we scan. A user can have multiple
   * sessions (multi-device), so we return the most recently created.
   */
  getSessionByUserId(userId: string): UserSession | undefined {
    let match: UserSession | undefined;
    for (const session of this.userSessions.values()) {
      if (session.userId === userId) match = session;
    }
    return match;
  }
}

// Start the app. The alpha SDK's AppServer extends Hono, so we hand
// it to Bun.serve() ourselves (instead of relying on the old
// app.start() auto-listen). `start()` is still called for SDK
// lifecycle hooks (version check, logging).
const app = new KaraokeApp();
app.start().catch(console.error);

const port = parseInt(process.env.PORT || "3000");
Bun.serve({
  port,
  hostname: process.env.HOST || "0.0.0.0",
  fetch: app.fetch,
});

console.log("Karaoke running...");
