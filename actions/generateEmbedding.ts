'use server';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { generateEmbeddingsInPineconeVectorStore } from '../lib/langchain';

export const generateEmbedding = async (docId: string) => {
  auth().protect(); // Protect this route with clark

  // Turn PDF into embeddings 0.012345, 2.20393 etc.
  await generateEmbeddingsInPineconeVectorStore(docId);

  revalidatePath('/dashboard');

  return { completed: true };
};
