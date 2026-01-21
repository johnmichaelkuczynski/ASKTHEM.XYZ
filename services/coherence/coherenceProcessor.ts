// server/services/coherence/coherenceProcessor.ts

import { db } from '../../db';
import { coherenceDocuments, coherenceChunks } from '../../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { openai } from '../aiProviders'; // Adjust to your actual LLM provider wrapper
import { v4 as uuidv4 } from 'uuid';
import {
  createInitialState,
  initializeCoherenceRun,
  readCoherenceState,
  updateCoherenceState,
  writeChunkEvaluation,
  applyStateUpdate,
  checkViolations,
  generateDocumentId,
} from './coherenceDatabase';

// ────────────────────────────────────────────────
// Utility helpers
// ────────────────────────────────────────────────

function chunkText(text: string, maxWords: number = 1000): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= maxWords) {
      chunks.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) {
    chunks.push(current.join(' '));
  }
  return chunks;
}

function autoDetectMode(firstChunk: string): string {
  // Simple heuristic – expand later with better detection
  const lower = firstChunk.toLowerCase();
  if (lower.includes('proof') || lower.includes('lemma') || lower.includes('theorem')) {
    return 'mathematical';
  }
  if (lower.includes('dialectic') || lower.includes('thesis') || lower.includes('antithesis')) {
    return 'philosophical';
  }
  return 'logical-consistency'; // fallback
}

// ────────────────────────────────────────────────
// Prompt builder (expand per mode)
// ────────────────────────────────────────────────

function buildEvaluationPrompt(
  mode: string,
  state: Record<string, any>,
  chunk: string,
  index: number,
  total: number,
  philosopherName?: string
): string {
  const base = `
You are evaluating coherence of chunk ${index + 1}/${total} in a document written in the voice of ${philosopherName || 'a philosopher'}.
Current global coherence state: ${JSON.stringify(state, null, 2)}

Chunk text:
${chunk}

Task: Analyze if this chunk preserves, weakens, or breaks overall coherence.
Return ONLY valid JSON with this exact structure:

{
  "status": "preserved" | "weakened" | "broken",
  "violations": [{"location": string, "type": string, "description": string, "severity": "low"|"medium"|"critical"}],
  "repairs": [{"location": string, "suggestion": string}],
  "state_update": {}  // partial updates to merge into global state
}
`;

  switch (mode) {
    case 'philosophical':
      return base + `
Focus on:
- Core concepts maintained?
- New distinctions properly introduced?
- Dialectic progression (thesis → antithesis → synthesis) logical?
- No unresolved objections left hanging.
`;
    case 'logical-consistency':
      return base + `
Focus on:
- No contradictions with prior assertions/negations.
- No new disjoint pairs introduced without resolution.
`;
    case 'mathematical':
      return base + `
Focus on:
- All referenced givens/lemmas already proved.
- Proof method consistent.
- No circular reasoning.
`;
    default:
      return base;
  }
}

function parseEvaluationResult(raw: string): any {
  try {
    // Strip any markdown code fences if LLM wraps it
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse evaluation JSON:', raw);
    return {
      status: 'broken',
      violations: [{ type: 'parse_error', description: 'Invalid JSON from LLM', severity: 'critical' }],
      repairs: [],
      state_update: {},
    };
  }
}

// ────────────────────────────────────────────────
// Main processing function
// ────────────────────────────────────────────────

export async function processDocumentCoherently(
  fullText: string,
  mode: string | null = null,
  philosopherId?: string,          // optional: for personality context
  philosopherName?: string,
  onProgress?: (index: number, total: number, status: string, violationsCount: number) => void
): Promise<{
  documentId: string;
  finalState: Record<string, any>;
  overallStatus: string;
  totalViolations: number;
}> {
  const documentId = generateDocumentId();
  const chunks = chunkText(fullText);
  if (chunks.length === 0) throw new Error('Empty document');

  mode = mode || autoDetectMode(chunks[0]);

  const initialState = createInitialState(mode);
  await initializeCoherenceRun(documentId, mode, initialState);

  // Process chunk 0 – extract initial state
  const chunk0Prompt = `
Extract initial coherence state from this opening chunk.
Return ONLY JSON matching the state structure for mode "${mode}".
Chunk:
${chunks[0]}
  `;
  const chunk0Resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: chunk0Prompt }],
  });
  const initialExtracted = parseEvaluationResult(chunk0Resp.choices[0].message.content || '{}');
  const stateAfterChunk0 = applyStateUpdate(initialState, initialExtracted.state_update || {});

  await updateCoherenceState(documentId, mode, stateAfterChunk0);
  await writeChunkEvaluation(documentId, mode, 0, chunks[0], initialExtracted, stateAfterChunk0);

  onProgress?.(0, chunks.length, 'preserved', 0);

  let currentState = stateAfterChunk0;
  let totalViolations = 0;

  // Process remaining chunks sequentially
  for (let i = 1; i < chunks.length; i++) {
    const prompt = buildEvaluationPrompt(mode, currentState, chunks[i], i, chunks.length, philosopherName);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
    });

    const result = parseEvaluationResult(response.choices[0].message.content || '{}');

    const { violations, isBroken } = checkViolations(currentState, result.state_update || {});
    totalViolations += violations.length;

    currentState = applyStateUpdate(currentState, result.state_update || {});

    await updateCoherenceState(documentId, mode, currentState);
    await writeChunkEvaluation(documentId, mode, i, chunks[i], { ...result, violations }, currentState);

    onProgress?.(i, chunks.length, result.status, violations.length);

    if (isBroken && result.status === 'broken') {
      console.warn(`Critical coherence break detected at chunk ${i}`);
      // Optionally early exit or flag for rewrite
    }
  }

  const overallStatus = totalViolations === 0 ? 'coherent' : totalViolations < 5 ? 'weakened' : 'incoherent';

  return {
    documentId,
    finalState: currentState,
    overallStatus,
    totalViolations,
  };
}