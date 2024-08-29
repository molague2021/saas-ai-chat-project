'use server';

import { Message } from '../components/Chat';
import { adminDb } from '@/firebaseAdmin';
import { auth } from '@clerk/nextjs/server';

const FREE_LIMIT = 3;
const PRO_LIMIT = 100;

export const askQuestions = async (id: string, question: string) => {
  auth().protect();
  const { userId } = await auth();

  const chatRef = adminDb
    .collection('users')
    .doc(userId!)
    .collection('files')
    .doc(id)
    .collection('chat');

  // check how many user messages are in chat
  const chatSnapshot = await chatRef.get();
  const userMessages = chatSnapshot.docs.filter(
    (doc) => doc.data().role === 'human'
  );

  // limit the PRO/FREE users
  const userMessage: Message = {
    role: 'human',
    message: question,
    createdAt: new Date(),
  };

  await chatRef.add(userMessage);

  // Generate AI response
  const reply = await generateLangchainCompletion(id, question);

  const aiMessage: Message = {
    role: 'ai',
    message: reply,
    createdAt: new Date(),
  };

  await chatRef.add(aiMessage);

  return { success: true, message: null };
};
