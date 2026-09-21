import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { telegramUserClientManager } from './features/telegram-signals/connectors/telegram-client-manager.js';

const serviceAccount = {
  projectId: "algovault-4c564",
  clientEmail: "firebase-adminsdk-fbsvc@algovault-4c564.iam.gserviceaccount.com",
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://algovault-4c564-default-rtdb.europe-west1.firebasedatabase.app"
});

async function startMonitoring() {
  try {
    console.log('Starting Telegram monitoring...');
    const result = await telegramUserClientManager.startMonitoring();
    console.log('Result:', result);
    
    // Check status after
    const status = await telegramUserClientManager.getStatus();
    console.log('Status after:', JSON.stringify(status, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

startMonitoring();
