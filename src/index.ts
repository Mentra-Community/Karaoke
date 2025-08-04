import { AppServer, AppSession } from "@mentra/sdk";
import { UserSession } from './UserSession';
import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

export class KaraokeApp extends AppServer {
  private userSessions = new Map<string, UserSession>();

  private acrConfig = {
    host: process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com',
    accessKey: process.env.ACRCLOUD_ACCESS_KEY || '',
    secretKey: process.env.ACRCLOUD_ACCESS_SECRET || ''
  };

  constructor() {
    super({
      packageName: process.env.PACKAGE_NAME || 'karaoke-app',
      apiKey: process.env.MENTRAOS_API_KEY || '',
      port: parseInt(process.env.PORT || '3000')
    });
    this.validateConfig();
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string
  ): Promise<void> {
    const logger = session.logger.child({ service: 'KaraokeApp' });
    logger.info({ sessionId, userId }, 'New session started');

    const userSession = new UserSession(
      userId,
      sessionId,
      session,
      this.acrConfig
    );

    this.userSessions.set(sessionId, userSession);
    
    userSession.startListening();

    this.addCleanupHandler(() => {
      logger.info({ sessionId, userId }, 'Cleaning up session');
      const session = this.userSessions.get(sessionId);
      if (session) {
        session.cleanup();
        this.userSessions.delete(sessionId);
      }
    });
  }

  private validateConfig(): void {
    if (!this.acrConfig.accessKey || !this.acrConfig.secretKey) {
      console.warn('ACRCloud credentials not configured. Please set ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET environment variables.');
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
    return Array.from(this.userSessions.values()).map(session => session.getStats());
  }
}

// Start the app
const app = new KaraokeApp();
app.start().catch(console.error);