import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  createJob,
  updateJob,
  getJob,
  createChunk,
  updateChunk,
  getChunkById,
  getPendingChunks,
  getCompletedChunks,
  getAllChunks,
  countWords,
  sleep,
  type GlobalSkeleton,
  type ChunkDelta,
  type ReconstructionJob,
  type ReconstructionChunk
} from './reconstructionDb';
import {
  buildSkeletonPrompt,
  buildChunkPrompt,
  buildRetryPrompt,
  buildStitchPrompt,
  summarizeChunk
} from './promptBuilders';

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const MAX_RETRIES = 3;
const SLEEP_BETWEEN_CHUNKS_MS = 2500;

async function callLLM(systemPrompt: string, userPrompt: string, maxTokens: number = 8000): Promise<string> {
  if (anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  } else if (openai) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    });
    return response.choices[0]?.message?.content || '';
  }
  throw new Error('No AI provider available - set ANTHROPIC_API_KEY or OPENAI_API_KEY');
}

function splitIntoChunks(text: string, targetWordsPerChunk: number = 500): string[] {
  // Split on any newline (single or double) to handle various formats
  const lines = text.split(/\n+/).filter(line => line.trim());
  const chunks: string[] = [];
  let currentChunk = '';
  let currentWords = 0;

  for (const line of lines) {
    const lineWords = countWords(line);
    if (currentWords + lineWords > targetWordsPerChunk && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
      currentWords = lineWords;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
      currentWords += lineWords;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // Ensure we have at least 1 chunk
  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }
  
  return chunks;
}

function determineLengthMode(ratio: number): string {
  if (ratio < 0.5) return 'heavy_compression';
  if (ratio < 0.8) return 'moderate_compression';
  if (ratio < 1.2) return 'maintain';
  if (ratio < 1.8) return 'moderate_expansion';
  return 'heavy_expansion';
}

function assignSectionsToChunks(outline: string[], numChunks: number): string[][] {
  const assignments: string[][] = [];
  const sectionsPerChunk = Math.ceil(outline.length / numChunks);
  
  for (let i = 0; i < numChunks; i++) {
    const start = i * sectionsPerChunk;
    const end = Math.min(start + sectionsPerChunk, outline.length);
    assignments.push(outline.slice(start, end));
  }
  
  return assignments;
}

export async function initializeJob(params: {
  userId: string;
  originalText: string;
  customInstructions: string;
  documentTitle?: string;
  targetWords?: number;
}): Promise<string> {
  const totalInputWords = countWords(params.originalText);
  const targetMid = params.targetWords || totalInputWords;
  const targetMin = Math.floor(targetMid * 0.9);
  const targetMax = Math.ceil(targetMid * 1.1);
  const lengthRatio = targetMid / totalInputWords;
  const lengthMode = determineLengthMode(lengthRatio);
  const numChunks = Math.max(1, Math.ceil(totalInputWords / 500));
  const chunkTargetWords = Math.ceil(targetMid / numChunks);

  console.log(`[Reconstruction] Initializing job: ${totalInputWords} input -> ${targetMid} target (${lengthMode})`);
  console.log(`[Reconstruction] ${numChunks} chunks, ${chunkTargetWords} words per chunk`);

  const jobId = await createJob({
    userId: params.userId,
    documentTitle: params.documentTitle,
    originalText: params.originalText,
    totalInputWords,
    targetMinWords: targetMin,
    targetMaxWords: targetMax,
    targetMidWords: targetMid,
    lengthRatio,
    lengthMode,
    numChunks,
    chunkTargetWords,
    customInstructions: params.customInstructions
  });

  return jobId;
}

export async function extractSkeleton(jobId: string): Promise<GlobalSkeleton> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  console.log(`[Reconstruction] Extracting skeleton for job ${jobId}`);
  await updateJob(jobId, { status: 'extracting_skeleton' });

  const { system, user } = buildSkeletonPrompt(job.original_text, job.custom_instructions);
  const response = await callLLM(system, user, 4000);

  let skeleton: GlobalSkeleton;
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      skeleton = JSON.parse(match[0]) as GlobalSkeleton;
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (e) {
    console.error('[Reconstruction] Skeleton parse error:', e);
    skeleton = {
      outline: ['Introduction', 'Main Argument', 'Supporting Evidence', 'Implications', 'Conclusion'],
      thesis: 'Document thesis could not be extracted',
      keyTerms: {},
      commitmentLedger: { asserts: [], rejects: [], assumes: [] },
      entities: [],
      audienceParameters: 'General',
      rigorLevel: 'academic'
    };
  }

  console.log(`[Reconstruction] Skeleton extracted: ${skeleton.outline.length} sections`);
  await updateJob(jobId, { globalSkeleton: skeleton, status: 'skeleton_complete' });

  return skeleton;
}

export async function createChunksForJob(jobId: string, skeleton: GlobalSkeleton): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  const chunks = splitIntoChunks(job.original_text, 500);
  const sectionAssignments = assignSectionsToChunks(skeleton.outline, chunks.length);

  console.log(`[Reconstruction] Creating ${chunks.length} chunks with section assignments`);

  for (let i = 0; i < chunks.length; i++) {
    const chunkWords = countWords(chunks[i]);
    await createChunk({
      jobId,
      chunkIndex: i,
      chunkInputText: chunks[i],
      chunkInputWords: chunkWords,
      targetWords: job.chunk_target_words,
      minWords: Math.floor(job.chunk_target_words * 0.8),
      maxWords: Math.ceil(job.chunk_target_words * 1.2)
    });
  }

  await updateJob(jobId, { status: 'chunks_created' });
}

export async function processAllChunks(
  jobId: string,
  skeleton: GlobalSkeleton,
  onProgress?: (chunkIndex: number, totalChunks: number, content: string) => void
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  const allChunks = await getAllChunks(jobId);
  const sectionAssignments = assignSectionsToChunks(skeleton.outline, allChunks.length);
  
  let previousSummary = '';
  let topicsCoveredSoFar: string[] = [];

  console.log(`[Reconstruction] Processing ${allChunks.length} chunks sequentially`);
  await updateJob(jobId, { status: 'processing_chunks' });

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    if (chunk.status === 'complete') {
      console.log(`[Reconstruction] Chunk ${i + 1} already complete, skipping`);
      if (chunk.chunk_output_text) {
        previousSummary = summarizeChunk(chunk.chunk_output_text);
      }
      if (chunk.chunk_delta?.topicsCovered) {
        topicsCoveredSoFar.push(...chunk.chunk_delta.topicsCovered);
      }
      continue;
    }

    console.log(`[Reconstruction] Processing chunk ${i + 1}/${allChunks.length}`);
    console.log(`[Reconstruction] Target: ${chunk.target_words} words, Min: ${chunk.min_words}`);
    console.log(`[Reconstruction] Assigned sections: ${sectionAssignments[i].join(', ')}`);

    const { system, user } = buildChunkPrompt({
      chunkIndex: i,
      totalChunks: allChunks.length,
      chunkInputText: chunk.chunk_input_text,
      chunkInputWords: chunk.chunk_input_words,
      targetWords: chunk.target_words,
      lengthMode: job.length_mode,
      skeleton,
      assignedSections: sectionAssignments[i],
      previousSummary,
      topicsCoveredSoFar
    });

    let response = await callLLM(system, user, Math.min(chunk.target_words * 2, 16000));
    let content = extractContent(response);
    let delta = extractDelta(response);
    let actualWords = countWords(content);
    let retryCount = 0;

    console.log(`[Reconstruction] Chunk ${i + 1} initial: ${actualWords} words (target: ${chunk.target_words})`);

    while (actualWords < chunk.min_words && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`[Reconstruction] Chunk ${i + 1} too short (${actualWords} < ${chunk.min_words}), retry ${retryCount}`);

      const retryPrompts = buildRetryPrompt({
        chunkIndex: i,
        originalOutput: content,
        actualWords,
        targetWords: chunk.target_words,
        minWords: chunk.min_words,
        assignedSections: sectionAssignments[i]
      });

      await sleep(1500);
      response = await callLLM(retryPrompts.system, retryPrompts.user, Math.min(chunk.target_words * 2, 16000));
      content = extractContent(response);
      delta = extractDelta(response);
      actualWords = countWords(content);

      console.log(`[Reconstruction] Chunk ${i + 1} retry ${retryCount}: ${actualWords} words`);
    }

    await updateChunk(chunk.id, {
      chunkOutputText: content,
      actualWords,
      chunkDelta: delta,
      retryCount,
      status: 'complete'
    });

    await updateJob(jobId, { currentChunk: i + 1 });

    previousSummary = summarizeChunk(content);
    if (delta.topicsCovered) {
      topicsCoveredSoFar.push(...delta.topicsCovered);
    }

    if (onProgress) {
      onProgress(i + 1, allChunks.length, content);
    }

    if (i < allChunks.length - 1) {
      console.log(`[Reconstruction] Sleeping ${SLEEP_BETWEEN_CHUNKS_MS}ms before next chunk`);
      await sleep(SLEEP_BETWEEN_CHUNKS_MS);
    }
  }

  console.log(`[Reconstruction] All chunks processed`);
  await updateJob(jobId, { status: 'chunks_complete' });
}

export async function stitchAndAssemble(jobId: string, skeleton: GlobalSkeleton): Promise<{ finalOutput: string; conflicts: string[] }> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  console.log(`[Reconstruction] Stitching and assembling output`);
  await updateJob(jobId, { status: 'stitching' });

  const completedChunks = await getCompletedChunks(jobId);
  
  const allDeltas = completedChunks.map(c => ({
    index: c.chunk_index,
    delta: c.chunk_delta as ChunkDelta
  }));

  const chunkSummaries = completedChunks.map(c => 
    summarizeChunk(c.chunk_output_text || '', 150)
  );

  const { system, user } = buildStitchPrompt({
    skeleton,
    allDeltas,
    chunkSummaries
  });

  const stitchResponse = await callLLM(system, user, 4000);
  let conflicts: string[] = [];
  
  try {
    const match = stitchResponse.match(/\{[\s\S]*\}/);
    if (match) {
      const stitchResult = JSON.parse(match[0]);
      conflicts = stitchResult.conflicts || [];
      if (stitchResult.redundancies?.length > 0) {
        console.log(`[Reconstruction] Redundancies found: ${stitchResult.redundancies.join(', ')}`);
      }
      if (stitchResult.gaps?.length > 0) {
        console.log(`[Reconstruction] Gaps found: ${stitchResult.gaps.join(', ')}`);
      }
    }
  } catch (e) {
    console.error('[Reconstruction] Stitch parse error:', e);
  }

  const finalOutput = completedChunks
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map(c => c.chunk_output_text)
    .join('\n\n');

  const finalWordCount = countWords(finalOutput);

  console.log(`[Reconstruction] Final output: ${finalWordCount} words (target: ${job.target_mid_words})`);
  if (conflicts.length > 0) {
    console.log(`[Reconstruction] Conflicts detected: ${conflicts.join(', ')}`);
  }

  await updateJob(jobId, {
    finalOutput,
    finalWordCount,
    status: 'complete'
  });

  return { finalOutput, conflicts };
}

export async function runReconstruction(params: {
  userId: string;
  originalText: string;
  customInstructions: string;
  documentTitle?: string;
  targetWords?: number;
  onProgress?: (chunkIndex: number, totalChunks: number, content: string) => void;
}): Promise<{ jobId: string; finalOutput: string; conflicts: string[] }> {
  const jobId = await initializeJob(params);

  const skeleton = await extractSkeleton(jobId);
  await createChunksForJob(jobId, skeleton);
  await processAllChunks(jobId, skeleton, params.onProgress);
  const result = await stitchAndAssemble(jobId, skeleton);

  return { jobId, ...result };
}

export async function resumeReconstruction(
  jobId: string,
  onProgress?: (chunkIndex: number, totalChunks: number, content: string) => void
): Promise<{ finalOutput: string; conflicts: string[] }> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  let skeleton = job.global_skeleton as GlobalSkeleton | null;

  if (!skeleton) {
    skeleton = await extractSkeleton(jobId);
    await createChunksForJob(jobId, skeleton);
  }

  const pendingChunks = await getPendingChunks(jobId);
  if (pendingChunks.length > 0) {
    await processAllChunks(jobId, skeleton, onProgress);
  }

  return await stitchAndAssemble(jobId, skeleton);
}

export async function getReconstructionStatus(jobId: string): Promise<{
  status: string;
  currentChunk: number;
  totalChunks: number;
  finalOutput: string | null;
  finalWordCount: number | null;
}> {
  const job = await getJob(jobId);
  if (!job) throw new Error('Job not found');

  return {
    status: job.status,
    currentChunk: job.current_chunk,
    totalChunks: job.num_chunks,
    finalOutput: job.final_output,
    finalWordCount: job.final_word_count
  };
}

function extractContent(response: string): string {
  const match = response.match(/\[CONTENT\]([\s\S]*?)(?:\[DELTA\]|$)/);
  if (match) {
    return match[1].trim();
  }
  const altMatch = response.match(/\[RECONSTRUCTED\]([\s\S]*?)(?:\[DELTA\]|$)/);
  if (altMatch) {
    return altMatch[1].trim();
  }
  return response.trim();
}

function extractDelta(response: string): ChunkDelta {
  const match = response.match(/\[DELTA\]\s*(\{[\s\S]*?\})/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {}
  }
  return { newClaims: [], termsUsed: [], conflictsDetected: [], topicsCovered: [] };
}
