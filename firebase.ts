import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyD2Peqd7o5EIkQjOy0kouP2HW2FsgyPt9I',
  authDomain: 'sass-ai-chat.firebaseapp.com',
  projectId: 'sass-ai-chat',
  storageBucket: 'sass-ai-chat.appspot.com',
  messagingSenderId: '951076851425',
  appId: '1:951076851425:web:9763eccd49c9113ed8b1a0',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
