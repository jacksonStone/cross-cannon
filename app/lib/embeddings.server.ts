import OpenAI from "openai";

let openai: OpenAI | null = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openai;
}

export async function embedText(text: string): Promise<number[] | null> {
  if (process.env.EMBEDDING_PROVIDER === "mock") {
    return mockEmbedding(text);
  }

  const client = getOpenAIClient();

  if (!client) {
    return null;
  }

  const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 1536);
  try {
    const response = await client.embeddings.create({
      model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
      input: text,
      dimensions,
      encoding_format: "float"
    });

    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.warn("Embedding request failed; continuing without vector embedding.");
    return null;
  }
}

function mockEmbedding(text: string) {
  const dimensions = 1536;
  const vector = Array.from({ length: dimensions }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const word of words) {
    let hash = 2166136261;
    for (let index = 0; index < word.length; index += 1) {
      hash ^= word.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1;
  }

  return vector;
}
