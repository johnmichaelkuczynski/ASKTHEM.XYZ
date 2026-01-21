// server/services/coherence/coherenceMeter.ts

import { db } from '../../db';
import { coherenceDocuments, coherenceChunks } from '../../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { openai } from '../aiProviders'; // your LLM wrapper

// ────────────────────────────────────────────────
// Final analysis & rewrite layer
// ────────────────────────────────────────────────

export interface CoherenceAnalysisResult {
  overallStatus: 'coherent' | 'weakened' | 'incoherent';
  score: number;                    // 0–100
  totalViolations: number;
  criticalViolations: number;
  assessment: string;
  majorIssues: string[];
  subscores: Record<string, number>;
}

export interface CoherenceRewriteResult {
  rewrittenText: string;
  changes: Array<{
    original: string;
    replacement: string;
    reason: string;
    location: string;
  }>;
}

/**
 * Get high-level coherence analysis after processing is finished
 */
export async function analyzeCoherence(
  documentId: string,
  mode: string
): Promise<CoherenceAnalysisResult> {
  const chunks = await db
    .select()
    .from(coherenceChunks)
    .where(and(
      eq(coherenceChunks.documentId, documentId),
      eq(coherenceChunks.coherenceMode, mode)
    ))
    .orderBy(coherenceChunks.chunkIndex);

  const globalState = await db
    .select({ state: coherenceDocuments.globalState })
    .from(coherenceDocuments)
    .where(and(
      eq(coherenceDocuments.documentId, documentId),
      eq(coherenceDocuments.coherenceMode, mode)
    ))
    .limit(1);

  const totalViolations = chunks.reduce(
    (sum, c) => sum + (c.evaluationResult.violations?.length || 0),
    0
  );

  const critical = chunks.reduce(
    (sum, c) => sum + (c.evaluationResult.violations?.filter((v: any) => v.severity === 'critical')?.length || 0),
    0
  );

  const status =
    totalViolations === 0 ? 'coherent' :
    totalViolations < 8 && critical === 0 ? 'weakened' :
    'incoherent';

  const score = Math.max(0, 100 - (totalViolations * 4) - (critical * 15));

  return {
    overallStatus: status,
    score: Math.round(score),
    totalViolations,
    criticalViolations: critical,
    assessment: `Document is ${status} with ${totalViolations} violations (${critical} critical).`,
    majorIssues: chunks
      .flatMap(c => (c.evaluationResult.violations || []).map((v: any) => v.description))
      .filter(Boolean),
    subscores: {
      consistency: 100 - totalViolations * 3,
      progression: status === 'coherent' ? 95 : status === 'weakened' ? 70 : 40,
      // add more subscores later
    }
  };
}

/**
 * Generate rewritten version that fixes known violations
 * (Usually called only when status === 'weakened' or 'incoherent')
 */
export async function rewriteForCoherence(
  originalFullText: string,
  documentId: string,
  mode: string,
  philosopherName?: string
): Promise<CoherenceRewriteResult> {
  const analysis = await analyzeCoherence(documentId, mode);
  if (analysis.overallStatus === 'coherent') {
    return { rewrittenText: originalFullText, changes: [] };
  }

  const chunks = await db
    .select()
    .from(coherenceChunks)
    .where(and(
      eq(coherenceChunks.documentId, documentId),
      eq(coherenceChunks.coherenceMode, mode)
    ))
    .orderBy(coherenceChunks.chunkIndex);

  const violationsSummary = chunks
    .flatMap(c => c.evaluationResult.violations || [])
    .map((v: any) => `- ${v.description} (at chunk ${c.chunkIndex + 1})`)
    .join('\n');

  const prompt = `
You are an expert philosophical editor.
Rewrite the following document to fix all coherence problems.

Original document:
${originalFullText}

Detected problems:
${violationsSummary}

Current global coherence state:
${JSON.stringify((await db.select({s: coherenceDocuments.globalState})
  .from(coherenceDocuments)
  .where(and(eq(coherenceDocuments.documentId, documentId), eq(coherenceDocuments.coherenceMode, mode)))
  .limit(1))[0]?.s ?? {})}

Rewrite goals:
• Preserve meaning and arguments
• Eliminate contradictions and drift
• Restore logical/dialectical progression
• Keep philosopher's voice (${philosopherName || 'philosophical'})

Return ONLY the full rewritten text.
  `;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: prompt }],
    temperature: 0.3,
    max_tokens: 8000,
  });

  const rewritten = response.choices[0]?.message?.content?.trim() || originalFullText;

  // Very rough diff – in production use real diff library
  const changes = []; // ← you can improve this a lot later

  return {
    rewrittenText: rewritten,
    changes,
  };
}