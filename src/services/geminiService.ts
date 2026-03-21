import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { auth } from "../firebase";
import { OperationType, FirestoreErrorInfo } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

function chunkText(text: string, chunkSize: number = 6000): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateSummary(content: string, attachments?: { name: string, type: string, data: string, isRawText?: boolean }[]) {
  const model = "gemini-3.1-pro-preview";
  
  const systemInstruction = `
    You are an Abstractive Hierarchical Summarizer, conceptually optimized on the 'BIG-PATENT' and 'GOV Report' datasets.
    Your goal is to provide precise, accurate, and highly professional abstractive summaries for long English documents.
    
    RULES:
    1. ONLY support English. If the document is in another language, state that you only support English.
    2. Adopt the formal, precise, and structured tone characteristic of BIG-PATENT and GOV Report datasets.
    3. Use a hierarchical approach: identify key claims/findings, summarize them, and provide a cohesive overall executive summary.
    4. Be abstractive: synthesize the information into novel, concise sentences rather than extracting verbatim quotes.
    5. Focus heavily on technical accuracy, methodologies, and core conclusions.
  `;

  let parts: any[] = [];
  let rawTextContent = content || "";
  const binaryAttachments: any[] = [];

  if (attachments) {
    for (const attachment of attachments) {
      if (attachment.isRawText) {
        rawTextContent += `\n\n--- Document: ${attachment.name} ---\n${attachment.data}`;
      } else {
        binaryAttachments.push({
          inlineData: {
            mimeType: attachment.type,
            data: attachment.data
          }
        });
      }
    }
  }

  // RAG Implementation for long text
  if (rawTextContent.length > 15000) {
    console.log("Document is long, applying RAG architecture for summarization...");
    const chunks = chunkText(rawTextContent, 6000);
    const safeChunks = chunks.slice(0, 60); // Limit to prevent rate limits
    
    try {
      const chunkEmbeddings: number[][] = [];
      // Batch embed to avoid rate limits
      for (let i = 0; i < safeChunks.length; i += 5) {
        const batch = safeChunks.slice(i, i + 5);
        const batchResults = await Promise.all(batch.map(chunk => 
          ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: chunk
          }).catch(e => { console.error("Embedding error", e); return null; })
        ));
        
        for (const res of batchResults) {
          if (res && res.embeddings && res.embeddings.length > 0) {
            chunkEmbeddings.push(res.embeddings[0].values);
          } else {
            chunkEmbeddings.push([]); // Empty fallback
          }
        }
      }
      
      // Embed query
      const query = "Abstract, main claims, core arguments, technical methodologies, findings, and conclusion.";
      const queryEmbedResponse = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: query
      });
      
      const queryEmbedding = queryEmbedResponse.embeddings[0].values;
      
      // Score and sort chunks
      const scoredChunks = safeChunks.map((chunk, i) => ({
        text: chunk,
        score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i])
      })).filter(c => c.score > 0);
      
      scoredChunks.sort((a, b) => b.score - a.score);
      
      // Retrieve top K chunks
      const topChunks = scoredChunks.slice(0, 15).map(c => c.text);
      
      parts.push({ text: `Please summarize the following extracted key sections of the document using RAG retrieval:\n\n${topChunks.join('\n\n...\n\n')}` });
    } catch (error) {
      console.error("RAG Embedding failed, falling back to full text:", error);
      parts.push({ text: rawTextContent });
    }
  } else {
    parts.push({ text: rawTextContent || "Summarize the attached document." });
  }

  parts = parts.concat(binaryAttachments);

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction,
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

export async function generateTitle(content: string) {
  const model = "gemini-3-flash-preview";
  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Generate a short, descriptive title (max 6 words) for this content: ${content.substring(0, 500)}`,
    });
    return response.text?.replace(/"/g, '').trim() || "New Summary";
  } catch (error) {
    return "New Summary";
  }
}
