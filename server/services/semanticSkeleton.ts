import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface GlobalSkeleton {
  outline: string[];
  thesis: string;
  keyTerms: Record<string, string>;
  commitmentLedger: { asserts: string[]; rejects: string[]; assumes: string[] };
  entities: string[];
  audienceParameters: string;
  rigorLevel: string;
}

export interface ChunkDelta {
  newClaims: string[];
  termsUsed: string[];
  conflictsDetected: string[];
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function determineLengthMode(ratio: number): string {
  if (ratio < 0.5) return 'heavy_compression';
  if (ratio < 0.8) return 'moderate_compression';
  if (ratio < 1.2) return 'maintain';
  if (ratio < 1.8) return 'moderate_expansion';
  return 'heavy_expansion';
}

function getLengthModeGuidance(mode: string): string {
  const templates: Record<string, string> = {
    heavy_compression: `LENGTH MODE: HEAVY COMPRESSION
You must significantly compress this chunk while preserving core arguments.
- Remove examples, keep only the most critical one
- Remove repetition and redundancy
- Convert detailed explanations to concise statements
- Preserve thesis statements and key claims verbatim`,
    moderate_compression: `LENGTH MODE: MODERATE COMPRESSION
You must compress this chunk while preserving argument structure.
- Keep the strongest 1-2 examples, remove weaker ones
- Tighten prose without losing meaning
- Preserve all key claims and their primary support`,
    maintain: `LENGTH MODE: MAINTAIN LENGTH
Your output should be approximately the same length as input.
- Improve clarity and coherence without changing length significantly
- Replace weak examples with stronger ones of similar length`,
    moderate_expansion: `LENGTH MODE: MODERATE EXPANSION
You must expand this chunk while maintaining focus.
- Add 1-2 supporting examples or evidence for key claims
- Elaborate on implications of major points
- Expand terse statements into fuller explanations`,
    heavy_expansion: `LENGTH MODE: HEAVY EXPANSION
You must significantly expand this chunk with substantive additions.
- Add 2-3 concrete examples (historical, empirical, or hypothetical)
- Elaborate on each major claim with supporting analysis
- Add relevant context and background
- Develop implications and consequences of arguments
- Do NOT add filler or padding—all additions must be substantive`
  };
  return templates[mode] || templates.maintain;
}

async function callLLM(prompt: string, systemPrompt: string, model: string = 'gpt-4o', maxTokens: number = 4000): Promise<string> {
  // Prefer Anthropic when available (since ANTHROPIC_API_KEY is set)
  if (anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  } else if (openai) {
    const response = await openai.chat.completions.create({
      model: model.includes('gpt') ? model : 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    });
    return response.choices[0]?.message?.content || '';
  }
  throw new Error('No AI provider available - set ANTHROPIC_API_KEY or OPENAI_API_KEY');
}

export async function extractGlobalSkeleton(
  documentText: string,
  customInstructions: string = '',
  model: string = 'gpt-4o'
): Promise<GlobalSkeleton> {
  const systemPrompt = `You are a document analyst. Extract the semantic skeleton of the document.
Return ONLY valid JSON with this exact structure:
{
  "outline": ["claim/section 1", "claim/section 2", ...],
  "thesis": "the central argument or purpose",
  "keyTerms": {"term1": "definition as used in document", ...},
  "commitmentLedger": {
    "asserts": ["what the document claims as true"],
    "rejects": ["what the document argues against"],
    "assumes": ["unstated background assumptions"]
  },
  "entities": ["people", "organizations", "technical terms"],
  "audienceParameters": "who this is written for",
  "rigorLevel": "casual/academic/technical"
}`;

  const prompt = `Extract the semantic skeleton from this document:

DOCUMENT:
${documentText.slice(0, 50000)}

${customInstructions ? `CUSTOM INSTRUCTIONS: ${customInstructions}` : ''}

Extract 8-20 numbered claims/sections in the outline. Be thorough but concise.
Return ONLY the JSON object, no other text.`;

  const response = await callLLM(prompt, systemPrompt, model);
  
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as GlobalSkeleton;
    }
  } catch (e) {
    console.error('[extractGlobalSkeleton] Parse error:', e);
  }
  
  return {
    outline: ['Document structure could not be extracted'],
    thesis: 'Unknown',
    keyTerms: {},
    commitmentLedger: { asserts: [], rejects: [], assumes: [] },
    entities: [],
    audienceParameters: 'General',
    rigorLevel: 'academic'
  };
}

export async function initializeReconstructionJob(
  originalText: string,
  customInstructions: string,
  targetWords: number,
  userId?: string
): Promise<string> {
  const totalInputWords = countWords(originalText);
  const targetMin = Math.floor(targetWords * 0.9);
  const targetMax = Math.ceil(targetWords * 1.1);
  const targetMid = targetWords;
  const lengthRatio = targetMid / totalInputWords;
  const lengthMode = determineLengthMode(lengthRatio);
  const numChunks = Math.ceil(totalInputWords / 500);
  const chunkTargetWords = Math.ceil(targetMid / numChunks);

  const result = await db.execute(sql`
    INSERT INTO reconstruction_jobs (
      user_id, original_text, total_input_words,
      target_min_words, target_max_words, target_mid_words,
      length_ratio, length_mode, num_chunks, chunk_target_words,
      custom_instructions, status
    ) VALUES (
      ${userId || 'anonymous'}, ${originalText}, ${totalInputWords},
      ${targetMin}, ${targetMax}, ${targetMid},
      ${lengthRatio}, ${lengthMode}, ${numChunks}, ${chunkTargetWords},
      ${customInstructions}, 'pending'
    ) RETURNING id
  `);
  
  return (result.rows[0] as any).id;
}

export async function updateJobSkeleton(jobId: string, skeleton: GlobalSkeleton): Promise<void> {
  await db.execute(sql`
    UPDATE reconstruction_jobs 
    SET global_skeleton = ${JSON.stringify(skeleton)}::jsonb, 
        status = 'skeleton_extraction',
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
  `);
}

export async function createChunkRecords(jobId: string, chunks: string[], chunkTargetWords: number): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    const chunkWords = countWords(chunks[i]);
    await db.execute(sql`
      INSERT INTO reconstruction_chunks (
        job_id, chunk_index, chunk_input_text, chunk_input_words,
        target_words, min_words, max_words, status
      ) VALUES (
        ${jobId}::uuid, ${i}, ${chunks[i]}, ${chunkWords},
        ${chunkTargetWords}, ${Math.floor(chunkTargetWords * 0.85)}, ${Math.ceil(chunkTargetWords * 1.15)}, 'pending'
      )
    `);
  }
}

export async function processChunkWithSkeleton(
  chunkText: string,
  skeleton: GlobalSkeleton,
  chunkIndex: number,
  targetWords: number,
  lengthMode: string,
  model: string = 'gpt-4o'
): Promise<{ output: string; delta: ChunkDelta }> {
  const lengthGuidance = getLengthModeGuidance(lengthMode);
  const inputWords = countWords(chunkText);
  
  // Calculate required tokens based on target words (roughly 1.3 tokens per word)
  const requiredTokens = Math.min(Math.ceil(targetWords * 1.5) + 500, 16000);
  
  const systemPrompt = `You are reconstructing a document chunk while maintaining global coherence.

GLOBAL SKELETON (you MUST respect this):
THESIS: ${skeleton.thesis}
KEY TERMS (use these definitions): ${JSON.stringify(skeleton.keyTerms)}
COMMITMENTS: Document asserts: ${skeleton.commitmentLedger.asserts.join(', ')}
             Document rejects: ${skeleton.commitmentLedger.rejects.join(', ')}

${lengthGuidance}

CRITICAL LENGTH REQUIREMENT:
- Input chunk: ${inputWords} words
- TARGET OUTPUT: ${targetWords} words (THIS IS MANDATORY)
- You MUST write approximately ${targetWords} words. Not ${inputWords}, but ${targetWords}.
${lengthMode === 'heavy_expansion' ? `- This is EXPANSION mode: you must ADD substantial content, examples, and elaboration to reach ${targetWords} words.` : ''}

STRICT RULE: Do NOT contradict the commitment ledger. Use key terms as defined.`;

  const prompt = `Reconstruct this chunk (chunk ${chunkIndex + 1}):

${chunkText}

REMEMBER: Your output MUST be approximately ${targetWords} words. The input is ${inputWords} words - you must ${lengthMode.includes('expansion') ? 'EXPAND significantly' : lengthMode.includes('compression') ? 'compress' : 'maintain length'}.

Write the reconstructed version AND then provide a delta report.
Format your response as:

[RECONSTRUCTED]
(your reconstructed text here - MUST BE ~${targetWords} WORDS)

[DELTA]
{"newClaims": [], "termsUsed": [], "conflictsDetected": []}`;

  const response = await callLLM(prompt, systemPrompt, model, requiredTokens);
  
  const reconstructedMatch = response.match(/\[RECONSTRUCTED\]([\s\S]*?)(?:\[DELTA\]|$)/);
  const deltaMatch = response.match(/\[DELTA\]\s*(\{[\s\S]*?\})/);
  
  const output = reconstructedMatch ? reconstructedMatch[1].trim() : chunkText;
  let delta: ChunkDelta = { newClaims: [], termsUsed: [], conflictsDetected: [] };
  
  if (deltaMatch) {
    try {
      delta = JSON.parse(deltaMatch[1]);
    } catch (e) {}
  }
  
  return { output, delta };
}

export async function updateChunkResult(
  jobId: string, 
  chunkIndex: number, 
  outputText: string, 
  delta: ChunkDelta
): Promise<void> {
  const actualWords = countWords(outputText);
  await db.execute(sql`
    UPDATE reconstruction_chunks 
    SET chunk_output_text = ${outputText},
        actual_words = ${actualWords},
        chunk_delta = ${JSON.stringify(delta)}::jsonb,
        status = 'complete',
        updated_at = NOW()
    WHERE job_id = ${jobId}::uuid AND chunk_index = ${chunkIndex}
  `);
  
  await db.execute(sql`
    UPDATE reconstruction_jobs
    SET current_chunk = ${chunkIndex + 1}, updated_at = NOW()
    WHERE id = ${jobId}::uuid
  `);
}

export async function performGlobalStitch(
  jobId: string,
  skeleton: GlobalSkeleton,
  model: string = 'gpt-4o'
): Promise<{ conflicts: string[]; repairPlan: string[] }> {
  const chunks = await db.execute(sql`
    SELECT chunk_index, chunk_delta FROM reconstruction_chunks
    WHERE job_id = ${jobId}::uuid ORDER BY chunk_index
  `);
  
  const allDeltas = (chunks.rows as any[]).map(r => ({
    index: r.chunk_index,
    delta: r.chunk_delta as ChunkDelta
  }));
  
  const systemPrompt = `You analyze cross-chunk coherence. Find contradictions, terminology drift, and redundancies.`;
  
  const prompt = `GLOBAL SKELETON:
${JSON.stringify(skeleton, null, 2)}

CHUNK DELTAS:
${JSON.stringify(allDeltas, null, 2)}

Identify:
1. Cross-chunk contradictions
2. Terminology drift
3. Redundancies

Return JSON: {"conflicts": ["issue 1", ...], "repairPlan": ["fix for issue 1", ...]}`;

  const response = await callLLM(prompt, systemPrompt, model);
  
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {}
  
  return { conflicts: [], repairPlan: [] };
}

export async function assembleOutput(jobId: string): Promise<string> {
  const chunks = await db.execute(sql`
    SELECT chunk_output_text FROM reconstruction_chunks
    WHERE job_id = ${jobId}::uuid ORDER BY chunk_index
  `);
  
  const output = (chunks.rows as any[])
    .map(r => r.chunk_output_text)
    .join('\n\n');
  
  const wordCount = countWords(output);
  
  await db.execute(sql`
    UPDATE reconstruction_jobs
    SET final_output = ${output}, final_word_count = ${wordCount}, status = 'complete', updated_at = NOW()
    WHERE id = ${jobId}::uuid
  `);
  
  return output;
}

export function splitIntoChunks(text: string, targetChunkWords: number = 500): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';
  let currentWords = 0;
  
  for (const para of paragraphs) {
    const paraWords = countWords(para);
    if (currentWords + paraWords > targetChunkWords && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
      currentWords = paraWords;
    } else {
      currentChunk += '\n\n' + para;
      currentWords += paraWords;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}
