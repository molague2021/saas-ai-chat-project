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
export const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',
});

export const indexName = 'saas';

const fetchMessagesFromDb = async (docId: string) => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('User not found');
  }

  console.log('--- Fetching chat history from the firestore database... ---');
  // Get the last 6 messages from the chat history
  const chats = await adminDb
    .collection('users')
    .doc(userId)
    .collection('files')
    .doc(docId)
    .collection('chat')
    .orderBy('createdAt', 'desc')
    //.limit(6)
    .get();

  const chatHistory = chats.docs.map((doc) =>
    doc.data().role === 'human'
      ? new HumanMessage(doc.data().message)
      : new AIMessage(doc.data().message)
  );

  console.log(
    `--- fetched last ${chatHistory.length} messages successfully ---`
  );

  console.log(chatHistory.map((msg) => msg.content.toString()));

  return chatHistory;
};

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

export const generateLangchainCompletion = async (
  docId: string,
  question: string
) => {
  let pineconeVectorStore;

  pineconeVectorStore = await generateEmbeddingsInPineconeVectorStore(docId);

  if (!pineconeVectorStore) {
    throw new Error('Pinecone vector store not found');
  }

  // Create a retriever to search through the vector store
  console.log('--- Creating a retriever... ---');
  const retriever = pineconeVectorStore.asRetriever();

  // Fetch the chat history from the database
  const chatHistory = await fetchMessagesFromDb(docId);

  // Define a promp template for generating search queries based on conversation history
  console.log('--- Defining a promp template... ---');

  const historyAwarePrompt = ChatPromptTemplate.fromMessages([
    ...chatHistory, // Insert the actual chat history here

    ['user', '{input}'],
    [
      'user',
      'Given the above conversation, generate a search query to look up in order to get information relevant to the conversation',
    ],
  ]);

  // Create a history-aware retriever chain that uses the model, retriever, and prompt
  console.log('--- Creating a history-aware retriever chain... ---');
  const historyAwareRetrieverChain = await createHistoryAwareRetriever({
    llm: model,
    retriever,
    rephrasePrompt: historyAwarePrompt,
  });

  // Define a prompt template for answering questions based on retrieved context
  console.log('--- Defining a prompt template for answering questions... ---');
  const historyAwareRetrievalPrompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      "Answer the user's questions based on the below context:\nm{context}",
    ],

    ...chatHistory, // Insert the actual chat history here

    ['user', '{import}'],
  ]);

  // Create a chain to combine the retrieved documents into a coherent response
  console.log('--- Creating a document combining chain...');
  const historyAwareCombineDocsChain = await createStuffDocumentsChain({
    llm: model,
    prompt: historyAwareRetrievalPrompt,
  });

  // Create the main retrieval chain that combines the history-aware retriever and document combining chains.
  console.log('--- Creating the main retrieval chain... ---');
  const conversationalRetrievalChain = await createRetrievalChain({
    retriever: historyAwareRetrieverChain,
    combineDocsChain: historyAwareCombineDocsChain,
  });

  console.log('--- Running the chain with a sample conversation... ---');
  const reply = await conversationalRetrievalChain.invoke({
    chat_history: chatHistory,
    input: question,
  });

  // Print the result to the console
  console.log(reply.answer);
  return reply.answer;
};
