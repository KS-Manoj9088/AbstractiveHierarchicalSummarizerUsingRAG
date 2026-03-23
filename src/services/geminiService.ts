import { GoogleGenAI } from "@google/genai";
import { auth } from "../firebase";
import { OperationType, FirestoreErrorInfo } from "../types";
import { retrieveRelevantChunks } from "./vectorStore";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const EMBED_MODEL = "gemini-embedding-2-preview";
const SUMMARY_MODEL = "gemini-2.5-flash";
const TITLE_MODEL = "gemini-2.5-flash";

export const handleFirestoreError = (
  error: unknown,
  operationType: OperationType,
  path: string | null
) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

function chunkText(text: string, chunkSize = 6000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function embedText(text: string): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
  });
  return res.embeddings?.[0]?.values ?? [];
}

export async function generateSummary(
  content: string,
  attachments?: { name: string; type: string; data: string; isRawText?: boolean }[]
) {
  // 1. Collect raw text and binary parts
  let rawText = content || "";
  const binaryParts: any[] = [];

  if (attachments) {
    for (const att of attachments) {
      if (att.isRawText) {
        rawText += `\n\n--- Document: ${att.name} ---\n${att.data}`;
      } else {
        binaryParts.push({ inlineData: { mimeType: att.type, data: att.data } });
      }
    }
  }

  // 2. BigPatent RAG: retrieve reference chunks for grounding
  let bigPatentContext = "";
  try {
    const queryText = rawText.slice(0, 2000) || "patent abstract claims technical summary";
    const queryEmbedding = await embedText(queryText);
    if (queryEmbedding.length > 0) {
      const chunks = retrieveRelevantChunks(queryEmbedding, 5);
      if (chunks.length > 0) {
        bigPatentContext =
          `RETRIEVED BIGPATENT REFERENCE EXAMPLES (use as style/structure references):\n` +
          chunks
            .map((c, i) => `[Ref ${i + 1} | Patent ${c.id} | Score: ${c.score.toFixed(3)}]\n${c.text}`)
            .join("\n\n---\n\n") +
          "\n\n";
        console.log(`BigPatent RAG: injected ${chunks.length} reference chunks`);
      }
    }
  } catch (e) {
    console.warn("BigPatent RAG retrieval skipped:", e);
  }

  // 3. Document-level RAG for long text (>15k chars)
  let textPrompt = "";
  if (rawText.length > 15000) {
    console.log("Long document — applying document RAG...");
    try {
      const docChunks = chunkText(rawText, 6000).slice(0, 60);
      const chunkEmbeddings: number[][] = [];

      // Embed in batches of 5
      for (let i = 0; i < docChunks.length; i += 5) {
        const batch = docChunks.slice(i, i + 5);
        const results = await Promise.all(
          batch.map((chunk) =>
            embedText(chunk).catch(() => [] as number[])
          )
        );
        chunkEmbeddings.push(...results);
      }

      const queryEmbedding = await embedText(
        "Abstract, main claims, core arguments, technical methodologies, findings, and conclusion."
      );

      const topChunks = docChunks
        .map((chunk, i) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map((c) => c.chunk);

      textPrompt =
        bigPatentContext +
        "Please summarize the following extracted key sections of the document:\n\n" +
        topChunks.join("\n\n...\n\n");
    } catch (e) {
      console.error("Document RAG failed, using full text:", e);
      textPrompt = bigPatentContext + rawText;
    }
  } else {
    textPrompt = bigPatentContext + (rawText || "Summarize the attached document.");
  }

  // 4. Build contents array for the API call
  // Text part always first, then any binary attachments
  const parts: any[] = [{ text: textPrompt }, ...binaryParts];

  const systemInstruction = `You are an Abstractive Hierarchical Summarizer trained on the BIG-PATENT and GOV Report datasets.
Your goal is to provide precise, accurate, and highly professional abstractive summaries for long English documents.
${bigPatentContext ? "You have been provided with real BigPatent reference examples. Use them to calibrate your summarization style, structure, and technical precision." : ""}

RULES:
1. ONLY support English. If the document is in another language, state that you only support English.
2. Adopt the formal, precise, and structured tone characteristic of BIG-PATENT and GOV Report datasets.
3. Use a hierarchical approach: identify key claims/findings, summarize them, and provide a cohesive overall executive summary.
4. Be abstractive: synthesize the information into novel, concise sentences rather than extracting verbatim quotes.
5. Focus heavily on technical accuracy, methodologies, and core conclusions.`;

  try {
    const response = await ai.models.generateContent({
      model: SUMMARY_MODEL,
      contents: [{ role: "user", parts }],
      config: { systemInstruction },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

export async function generateTitle(content: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: TITLE_MODEL,
      contents: `Generate a short, descriptive title (max 6 words) for this content: ${content.substring(0, 500)}`,
    });
    return response.text?.replace(/"/g, "").trim() || "New Summary";
  } catch {
    return "New Summary";
  }
}
