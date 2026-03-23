/**
 * BigPatent RAG Index Builder
 *
 * Downloads samples from the BigPatent dataset (via HuggingFace datasets API),
 * chunks the patent descriptions, embeds them using Gemini Embeddings,
 * and saves the vector index to src/data/bigpatent-index.json
 *
 * Usage:
 *   npx tsx scripts/buildBigPatentIndex.ts
 *
 * Set GEMINI_API_KEY in your .env.local before running.
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// BigPatent has 9 CPC categories: a,b,c,d,e,f,g,h,y
// We sample from a few to keep the index manageable
const CATEGORIES = ["a", "b", "g"];
const SAMPLES_PER_CATEGORY = 20; // Increase for a richer index (costs more API calls)
const CHUNK_SIZE = 1500;
const OUTPUT_PATH = path.resolve("src/data/bigpatent-index.json");

interface IndexEntry {
  id: string;
  category: string;
  title: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  // Embed one at a time to stay within rate limits
  for (const text of texts) {
    try {
      const res = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: text,
      });
      results.push(res.embeddings?.[0]?.values ?? []);
    } catch (e) {
      console.error("Embedding failed for chunk, skipping:", e);
      results.push([]);
    }
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

async function fetchBigPatentSamples(
  category: string,
  limit: number
): Promise<{ patent_number: string; description: string; abstract: string }[]> {
  // HuggingFace datasets-server API — no auth needed for public datasets
  const url = `https://datasets-server.huggingface.co/rows?dataset=big_patent&config=${category}&split=train&offset=0&length=${limit}`;
  console.log(`  Fetching ${limit} samples for category '${category}'...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HuggingFace API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { rows: { row: any }[] };
  return json.rows.map((r, i) => ({
    patent_number: `${category.toUpperCase()}-${String(i).padStart(4, "0")}`,
    description: r.row.description ?? "",
    abstract: r.row.abstract ?? "",
  }));
}

async function main() {
  console.log("=== BigPatent RAG Index Builder ===\n");

  if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY not set in .env.local");
    process.exit(1);
  }

  // Ensure output directory exists
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const index: IndexEntry[] = [];

  for (const category of CATEGORIES) {
    console.log(`\nProcessing category: ${category.toUpperCase()}`);
    let samples: Awaited<ReturnType<typeof fetchBigPatentSamples>>;

    try {
      samples = await fetchBigPatentSamples(category, SAMPLES_PER_CATEGORY);
    } catch (e) {
      console.error(`  Failed to fetch category ${category}:`, e);
      continue;
    }

    for (const sample of samples) {
      // Use abstract + first part of description for richer context
      const fullText = `ABSTRACT: ${sample.abstract}\n\nDESCRIPTION: ${sample.description}`;
      const chunks = chunkText(fullText, CHUNK_SIZE);
      const safeChunks = chunks.slice(0, 5); // Max 5 chunks per patent

      console.log(
        `  Patent ${sample.patent_number}: ${safeChunks.length} chunks`
      );

      const embeddings = await embedBatch(safeChunks);

      safeChunks.forEach((chunk, i) => {
        if (embeddings[i].length > 0) {
          index.push({
            id: sample.patent_number,
            category,
            title: `Patent ${sample.patent_number}`,
            chunkIndex: i,
            text: chunk,
            embedding: embeddings[i],
          });
        }
      });
    }
  }

  console.log(`\nTotal index entries: ${index.length}`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2));
  console.log(`Index saved to: ${OUTPUT_PATH}`);
  console.log("\nDone. You can now use the RAG pipeline in the app.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
