/**
 * Vector Store — loads the BigPatent index and performs cosine similarity retrieval.
 * The index is built by running: npx tsx scripts/buildBigPatentIndex.ts
 */

// Static import — Vite handles JSON natively and tree-shakes it correctly at build time.
// If the index is empty (not yet built), retrieval simply returns no results.
import indexData from "../data/bigpatent-index.json";

interface IndexEntry {
  id: string;
  category: string;
  title: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

interface RetrievedChunk {
  text: string;
  score: number;
  id: string;
  category: string;
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

const index: IndexEntry[] = Array.isArray(indexData) ? (indexData as IndexEntry[]) : [];

if (index.length > 0) {
  console.log(`BigPatent index loaded: ${index.length} entries`);
} else {
  console.warn("BigPatent index is empty. Run: npm run build:rag-index");
}

/**
 * Retrieve the top-K most relevant chunks from the BigPatent index
 * given a query embedding.
 */
export function retrieveRelevantChunks(
  queryEmbedding: number[],
  topK = 5
): RetrievedChunk[] {
  if (index.length === 0) return [];

  return index
    .map((entry) => ({
      text: entry.text,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
      id: entry.id,
      category: entry.category,
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
