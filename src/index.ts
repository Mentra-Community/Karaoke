import { ToolCall, AppServer, AppSession } from '@mentra/sdk';
import path from 'path';
// import { setupExpressRoutes } from './webview';
import { handleToolCall } from './tools';
import express, { Request, Response } from 'express';
import cors from 'cors';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');

// Parse allowed origins from environment
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173', // Vite dev server
  'http://localhost:5174', // Vite dev server
  'http://localhost:4242', // Vite dev server
  'http://localhost:3000',  // Local testing
  'https://isaiah-webview.ngrok.app', // Vite dev server
  "https://lovable.dev/projects/503c96b8-c721-40e6-b378-305dbdaf5f43", // Production webview
  "https://lovable.dev",
  "https://karaokeval.lovable.app",
  "https://503c96b8-c721-40e6-b378-305dbdaf5f43.lovableproject.com",
];


class KaraokivallApp extends AppServer {
  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      // publicDir: path.join(__dirname, '../public'),
    });

    // Set up Express routes
    // setupExpressRoutes(this);
  }

  /** Map to store active user sessions */
  private userSessionsMap = new Map<string, AppSession>();

  /**
   * Handles tool calls from the MentraOS system
   * @param toolCall - The tool call request
   * @returns Promise resolving to the tool call response or undefined
   */
  // protected async onToolCall(toolCall: ToolCall): Promise<string | undefined> {
  //   return handleToolCall(toolCall, toolCall.userId, this.userSessionsMap.get(toolCall.userId));
  // }

  /**
   * Handles new user sessions
   * Sets up event listeners and displays welcome message
   * @param session - The app session instance
   * @param sessionId - Unique session identifier
   * @param userId - User identifier
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    const email = userId.toLowerCase();
    this.userSessionsMap.set(email, session);

    // automatically remove the session when the session ends
    this.addCleanupHandler(() => this.userSessionsMap.delete(email));
  }

  public showTextToAllSessions(text: string): void {
    this.userSessionsMap.forEach((session) => {
      session.layouts.showTextWall(text);
    });
  }

  public showTextForSession(email: string, text: string): void {
    const session = this.userSessionsMap.get(email);
    if (session) {
      console.log(`Showing text for session: ${email} ${text}`);
      session.layouts.showTextWall(text);
    }
    else {
      console.warn(`No session found for email: ${email}`);
    }
  }
}

// Start the server
const app = new KaraokivallApp();


const expressApp = app.getExpressApp();
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: true }));

// CORS configuration for separate servers
expressApp.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    // Log rejected origins for debugging
    console.warn(`CORS blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
expressApp.options('*', cors());


expressApp.post('/api/set-text', (req: any, res: any) => {
  const { text, email } = req.body;
  if (!text) {
    return res.status(400).send('Text is required');
  }
  if (email) {
    const emailLower = email.toLowerCase();
    app.showTextForSession(emailLower, text);
    return res.json({ message: 'Text set successfully for session', text, email: emailLower });
  }

  // If no email is provided, show text to all sessions
  app.showTextToAllSessions(text);
  res.json({ message: 'Text set successfully', text });
});

expressApp.post('/api/set-text/:email', (req: any, res: any) => {
  const email = req.params.email?.toLowerCase();
  if (!email) {
    return res.status(400).send('Email is required');
  }
  const text = req.body.text;
  if (!text) {
    return res.status(400).send('Text is required');
  }
  app.showTextForSession(email, text);
  res.json({ message: 'Text set successfully', text });
});


app.start().catch(console.error);