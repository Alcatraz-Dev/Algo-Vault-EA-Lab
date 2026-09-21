import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const serviceAccount = {
  projectId: "algovault-4c564",
  clientEmail: "firebase-adminsdk-fbsvc@algovault-4c564.iam.gserviceaccount.com",
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://algovault-4c564-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = getDatabase();

async function checkData() {
  try {
    // Check telegramSources
    const sourcesSnap = await db.ref('telegramSources').once('value');
    console.log('=== telegramSources ===');
    if (sourcesSnap.exists()) {
      const sources = sourcesSnap.val();
      Object.entries(sources).forEach(([key, val]) => {
        console.log(`Source: ${key}`);
        console.log(`  name: ${val.name}`);
        console.log(`  channelId: ${val.channelId}`);
        console.log(`  enabled: ${val.enabled}`);
        console.log(`  parsingEnabled: ${val.parsingEnabled}`);
        console.log(`  signalCount: ${val.signalCount}`);
        console.log(`  groupId: ${val.groupId}`);
        console.log(`  style: ${val.style}`);
        console.log(`  lastReceivedAt: ${val.lastReceivedAt ? new Date(val.lastReceivedAt).toISOString() : 'never'}`);
        console.log('');
      });
    } else {
      console.log('No sources found');
    }
    
    // Check telegramAdminConfig
    const adminSnap = await db.ref('telegramAdminConfig/publicStatus').once('value');
    console.log('=== telegramAdminConfig ===');
    if (adminSnap.exists()) {
      console.log(JSON.stringify(adminSnap.val(), null, 2));
    } else {
      console.log('No admin config found');
    }
    
    // Check telegramLogs (last 10)
    const logsSnap = await db.ref('telegramLogs').limitToLast(10).once('value');
    console.log('=== telegramLogs (last 10) ===');
    if (logsSnap.exists()) {
      const logs = logsSnap.val();
      Object.entries(logs).forEach(([key, val]) => {
        console.log(`${new Date(val.timestamp).toISOString()} [${val.level}] ${val.message}`);
        if (val.details) console.log(`  Details: ${val.details.substring(0, 100)}`);
      });
    } else {
      console.log('No logs found');
    }
    
    // Check telegramMessages
    const messagesSnap = await db.ref('telegramMessages').once('value');
    console.log('=== telegramMessages ===');
    if (messagesSnap.exists()) {
      const messages = messagesSnap.val();
      Object.entries(messages).forEach(([userId, userMessages]) => {
        console.log(`User: ${userId} - ${Object.keys(userMessages).length} messages`);
        Object.entries(userMessages).slice(-3).forEach(([msgId, msg]) => {
          console.log(`  ${msgId}: ${msg.processingStatus} - ${msg.rawText?.substring(0, 80)}`);
        });
      });
    } else {
      console.log('No messages found');
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

checkData();
