/**
 * Vector Store — loads the BigPatent index and performs cosine similarity retrieval.
 * The index is built by running: npx tsx scripts/buildBigPatentIndex.ts
 */

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

let cachedIndex: IndexEntry[] | null = null;

export async function loadIndex(): Promise<IndexEntry[]> {
  if (cachedIndex) return cachedIndex;

  try {
    // Vite handles JSON imports natively
    const module = await import("../data/bigpatent-index.json");
    cachedIndex = module.default as IndexEntry[];
    console.log(`BigPatent index loaded: ${cachedIndex.length} entries`);
    return cachedIndex;
  } catch {
    console.warn(
      "BigPatent index not found. Run: npx tsx scripts/buildBigPatentIndex.ts"
    );
    return [];
  }
}

/**
 * Retrieve the top-K most relevant chunks from the BigPatent index
 * given a query embedding.
 */
export async function retrieveRelevantChunks(
  queryEmbedding: number[],
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const index = await loadIndex();
  if (index.length === 0) return [];

  const scored = index
    .map((entry) => ({
      text: entry.text,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
      id: entry.id,
      category: entry.category,
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
