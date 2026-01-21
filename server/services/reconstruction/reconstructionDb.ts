import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface ReconstructionJob {
  id: string;
  user_id: string;
  document_title: string | null;
  original_text: string;
  total_input_words: number;
  target_min_words: number;
  target_max_words: number;
  target_mid_words: number;
  length_ratio: number;
  length_mode: string;
  num_chunks: number;
  chunk_target_words: number;
  global_skeleton: GlobalSkeleton | null;
  custom_instructions: string;
  status: string;
  current_chunk: number;
  final_output: string | null;
  final_word_count: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReconstructionChunk {
  id: string;
  job_id: string;
  chunk_index: number;
  chunk_input_text: string;
  chunk_input_words: number;
  target_words: number;
  min_words: number;
  max_words: number;
  chunk_output_text: string | null;
  actual_words: number | null;
  chunk_delta: ChunkDelta | null;
  retry_count: number;
  status: string;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

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
  topicsCovered: string[];
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function createJob(params: {
  userId: string;
  documentTitle?: string;
  originalText: string;
  totalInputWords: number;
  targetMinWords: number;
  targetMaxWords: number;
  targetMidWords: number;
  lengthRatio: number;
  lengthMode: string;
  numChunks: number;
  chunkTargetWords: number;
  customInstructions: string;
}): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO reconstruction_jobs (
      user_id, document_title, original_text, total_input_words,
      target_min_words, target_max_words, target_mid_words,
      length_ratio, length_mode, num_chunks, chunk_target_words,
      custom_instructions, status
    ) VALUES (
      ${params.userId}, ${params.documentTitle || null}, ${params.originalText}, ${params.totalInputWords},
      ${params.targetMinWords}, ${params.targetMaxWords}, ${params.targetMidWords},
      ${params.lengthRatio}, ${params.lengthMode}, ${params.numChunks}, ${params.chunkTargetWords},
      ${params.customInstructions}, 'pending'
    ) RETURNING id
  `);
  return (result.rows[0] as any).id;
}

export async function updateJob(jobId: string, updates: Partial<{
  status: string;
  currentChunk: number;
  globalSkeleton: GlobalSkeleton;
  finalOutput: string;
  finalWordCount: number;
}>): Promise<void> {
  const setClauses: string[] = ['updated_at = NOW()'];
  
  if (updates.status !== undefined) {
    await db.execute(sql`UPDATE reconstruction_jobs SET status = ${updates.status}, updated_at = NOW() WHERE id = ${jobId}::uuid`);
  }
  if (updates.currentChunk !== undefined) {
    await db.execute(sql`UPDATE reconstruction_jobs SET current_chunk = ${updates.currentChunk}, updated_at = NOW() WHERE id = ${jobId}::uuid`);
  }
  if (updates.globalSkeleton !== undefined) {
    await db.execute(sql`UPDATE reconstruction_jobs SET global_skeleton = ${JSON.stringify(updates.globalSkeleton)}::jsonb, updated_at = NOW() WHERE id = ${jobId}::uuid`);
  }
  if (updates.finalOutput !== undefined) {
    await db.execute(sql`UPDATE reconstruction_jobs SET final_output = ${updates.finalOutput}, updated_at = NOW() WHERE id = ${jobId}::uuid`);
  }
  if (updates.finalWordCount !== undefined) {
    await db.execute(sql`UPDATE reconstruction_jobs SET final_word_count = ${updates.finalWordCount}, updated_at = NOW() WHERE id = ${jobId}::uuid`);
  }
}

export async function getJob(jobId: string): Promise<ReconstructionJob | null> {
  const result = await db.execute(sql`
    SELECT * FROM reconstruction_jobs WHERE id = ${jobId}::uuid
  `);
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as ReconstructionJob;
}

export async function createChunk(params: {
  jobId: string;
  chunkIndex: number;
  chunkInputText: string;
  chunkInputWords: number;
  targetWords: number;
  minWords: number;
  maxWords: number;
}): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO reconstruction_chunks (
      job_id, chunk_index, chunk_input_text, chunk_input_words,
      target_words, min_words, max_words, status
    ) VALUES (
      ${params.jobId}::uuid, ${params.chunkIndex}, ${params.chunkInputText}, ${params.chunkInputWords},
      ${params.targetWords}, ${params.minWords}, ${params.maxWords}, 'pending'
    ) RETURNING id
  `);
  return (result.rows[0] as any).id;
}

export async function updateChunk(chunkId: string, updates: Partial<{
  chunkOutputText: string;
  actualWords: number;
  chunkDelta: ChunkDelta;
  retryCount: number;
  status: string;
  errorMessage: string;
}>): Promise<void> {
  if (updates.chunkOutputText !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET chunk_output_text = ${updates.chunkOutputText}, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
  if (updates.actualWords !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET actual_words = ${updates.actualWords}, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
  if (updates.chunkDelta !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET chunk_delta = ${JSON.stringify(updates.chunkDelta)}::jsonb, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
  if (updates.retryCount !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET retry_count = ${updates.retryCount}, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
  if (updates.status !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET status = ${updates.status}, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
  if (updates.errorMessage !== undefined) {
    await db.execute(sql`UPDATE reconstruction_chunks SET error_message = ${updates.errorMessage}, updated_at = NOW() WHERE id = ${chunkId}::uuid`);
  }
}

export async function getChunkById(chunkId: string): Promise<ReconstructionChunk | null> {
  const result = await db.execute(sql`
    SELECT * FROM reconstruction_chunks WHERE id = ${chunkId}::uuid
  `);
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as ReconstructionChunk;
}

export async function getPendingChunks(jobId: string): Promise<ReconstructionChunk[]> {
  const result = await db.execute(sql`
    SELECT * FROM reconstruction_chunks 
    WHERE job_id = ${jobId}::uuid AND status = 'pending'
    ORDER BY chunk_index
  `);
  return result.rows as unknown as ReconstructionChunk[];
}

export async function getCompletedChunks(jobId: string): Promise<ReconstructionChunk[]> {
  const result = await db.execute(sql`
    SELECT * FROM reconstruction_chunks 
    WHERE job_id = ${jobId}::uuid AND status = 'complete'
    ORDER BY chunk_index
  `);
  return result.rows as unknown as ReconstructionChunk[];
}

export async function getAllChunks(jobId: string): Promise<ReconstructionChunk[]> {
  const result = await db.execute(sql`
    SELECT * FROM reconstruction_chunks 
    WHERE job_id = ${jobId}::uuid
    ORDER BY chunk_index
  `);
  return result.rows as unknown as ReconstructionChunk[];
}
