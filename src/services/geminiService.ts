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

export async function generateSummary(content: string, attachments?: { name: string, type: string, data: string }[]) {
  const model = "gemini-3.1-pro-preview";
  
  const systemInstruction = `
    You are an Abstractive Hierarchical Summarizer. 
    Your goal is to provide precise and accurate summaries for long documents.
    
    RULES:
    1. ONLY support English. If the document is in another language, state that you only support English.
    2. Handle all multimodal content: images, illustrations, graphs, notations, emojis, and pictures. Perform OCR and visual analysis where necessary.
    3. Use a hierarchical approach: identify key sections, summarize them, and then provide a cohesive overall summary.
    4. Be abstractive: don't just copy-paste, synthesize the information.
    5. If there are graphs or notations, explain their significance in the summary.
  `;

  const parts: any[] = [{ text: content || "Summarize the attached document." }];

  if (attachments) {
    for (const attachment of attachments) {
      parts.push({
        inlineData: {
          mimeType: attachment.type,
          data: attachment.data
        }
      });
    }
  }

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
