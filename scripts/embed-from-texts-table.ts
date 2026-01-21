import { neon } from '@neondatabase/serverless';
import OpenAI from 'openai';

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = neon(DATABASE_URL);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > start + CHUNK_SIZE * 0.5) {
        end = breakPoint + 1;
      }
    }
    
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 100) {
      chunks.push(chunk);
    }
    
    start = end - CHUNK_OVERLAP;
  }
  
  return chunks;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

async function main() {
  const thinker = process.argv[2];
  
  if (!thinker) {
    console.error('Usage: npx tsx scripts/embed-from-texts-table.ts <thinker-name>');
    console.error('Example: npx tsx scripts/embed-from-texts-table.ts jung');
    process.exit(1);
  }
  
  console.log(`\nEmbedding texts for: ${thinker}`);
  console.log('='.repeat(50));
  
  const texts = await sql`
    SELECT id, title, content FROM texts 
    WHERE LOWER(thinker) = LOWER(${thinker})
    ORDER BY title
  `;
  
  console.log(`Found ${texts.length} texts to process\n`);
  
  if (texts.length === 0) {
    console.log('No texts found for this thinker.');
    process.exit(0);
  }
  
  let totalChunks = 0;
  
  for (const text of texts) {
    console.log(`Processing: ${text.title}`);
    
    const existingChunks = await sql`
      SELECT COUNT(*) as count FROM chunks 
      WHERE thinker = ${thinker} AND source_text_id = ${text.id}
    `;
    
    if (parseInt(existingChunks[0].count as string) > 0) {
      console.log(`  Already has ${existingChunks[0].count} chunks, skipping...`);
      continue;
    }
    
    const chunks = chunkText(text.content as string);
    console.log(`  Creating ${chunks.length} chunks...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      process.stdout.write(`  Embedding chunk ${i + 1}/${chunks.length}...`);
      
      try {
        const embedding = await generateEmbedding(chunk);
        
        await sql`
          INSERT INTO chunks (id, thinker, source_text_id, chunk_index, chunk_text, embedding)
          VALUES (
            gen_random_uuid(),
            ${thinker},
            ${text.id},
            ${i},
            ${chunk},
            ${JSON.stringify(embedding)}::vector
          )
        `;
        
        totalChunks++;
        process.stdout.write(' done\n');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error: any) {
        process.stdout.write(` ERROR: ${error.message}\n`);
      }
    }
  }
  
  console.log(`\nDone! Created ${totalChunks} chunks for ${thinker}`);
  
  const finalCount = await sql`SELECT COUNT(*) as count FROM chunks WHERE thinker = ${thinker}`;
  console.log(`Total chunks in database for ${thinker}: ${finalCount[0].count}`);
}

main().catch(console.error);
