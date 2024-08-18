import { ChatOpenAI } from '@langchain/openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import { createHistoryAwareRetriever } from 'langchain/chains/history_aware_retriever';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import pineconeClient from './pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { PineconeConflictError } from '@pinecone-database/pinecone/dist/errors';
import { Index, RecordMetadata } from '@pinecone-database/pinecone';
import { adminDb } from '../firebaseAdmin';
import { auth } from '@clerk/nextjs/server';

// Initialize openAI modal with API key and model name
const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',
});

export const indexName = 'saas';

const namespaceExists = async (
  index: Index<RecordMetadata>,
  namespace: string
) => {
  if (!namespace) {
    throw new Error('No namespace value provided.');
  }
  const { namespaces } = await index.describeIndexStats();
  return namespaces?.[namespace] !== undefined;
};

export const generateDocs = async (docId: string) => {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('User not found!');
  }

  console.log('-- fetching the download URL from firebase... --');
  const firebaseRef = await adminDb
    .collection('users')
    .doc(userId)
    .collection('files')
    .doc(docId)
    .get();

  console.log('firebaseData ', firebaseRef.data());

  const downloadUrl = firebaseRef.data()?.downloadUrl;

  if (!downloadUrl) {
    throw new Error('Download URL not found');
  }

  console.log(`-- Download URL fetched successfully: ${downloadUrl} --`);

  // Fetch the PDF from the specified URL
  const response = await fetch(downloadUrl);

  // Load the PDF into a PDFDocument object
  const data = await response.blob();

  // Load the PDF document from the specified path
  console.log('-- Loading PDF document... --');
  const loader = new PDFLoader(data);
  const docs = await loader.load();

  // Split the loaded document into smaller parrts for easier processing
  console.log('--- Splitting the document into smaller parts... ---');
  const splitter = new RecursiveCharacterTextSplitter();

  const splitDocs = await splitter.splitDocuments(docs);
  console.log(`--- Split into ${splitDocs.length} parts ---`);

  return splitDocs;
};

export const generateEmbeddingsInPineconeVectorStore = async (
  docId: string
) => {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('User not found');
  }

  let pineconeVectorStore;

  // Generate embeddings (numerical representations) for the split documents
  console.log('--- Generating embedding... ---');
  // We get embedding from OpenAI
  const embeddings = new OpenAIEmbeddings();

  // Connection to pinecone index
  const index = await pineconeClient.index(indexName);
  //Check if pinecone index namespace exists
  const namespaceAlreadyExists = await namespaceExists(index, docId);

  if (namespaceAlreadyExists) {
    console.log(
      `--- Namespace ${docId} already exists, reusing existing embedding...`
    );

    pineconeVectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: docId,
    });

    return pineconeVectorStore;
  } else {
    // if namespace does not exists, download the PDF from firestore via the stored Download URL,
    // and generate embeddings and store them in the pinecone vector store.
    const splitDocs = await generateDocs(docId);

    console.log(
      `--- Storing the embeddings in namespace ${docId} in the ${indexName} Pinecone vector store ---`
    );
    pineconeVectorStore = await PineconeStore.fromDocuments(
      splitDocs,
      embeddings,
      {
        pineconeIndex: index,
        namespace: docId,
      }
    );

    return pineconeVectorStore;
  }
};
