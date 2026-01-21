import type { GlobalSkeleton, ChunkDelta } from './reconstructionDb';

export function buildSkeletonPrompt(documentText: string, customInstructions: string): { system: string; user: string } {
  const system = `You are a document analyst. Extract the semantic skeleton of the document.
Return ONLY valid JSON with this exact structure:
{
  "outline": ["Section 1: topic", "Section 2: topic", ...],
  "thesis": "the central argument or purpose",
  "keyTerms": {"term1": "definition as used in document", ...},
  "commitmentLedger": {
    "asserts": ["claims the document makes"],
    "rejects": ["positions the document argues against"],
    "assumes": ["unstated background assumptions"]
  },
  "entities": ["people", "organizations", "technical terms mentioned"],
  "audienceParameters": "who this is written for",
  "rigorLevel": "casual/academic/technical"
}

CRITICAL: The outline must be a PROGRESSIVE list of distinct topics/sections that BUILD on each other.
Each section should cover DIFFERENT material. NO repetition between sections.`;

  const user = `Extract the semantic skeleton from this document:

DOCUMENT:
${documentText.slice(0, 50000)}

${customInstructions ? `CUSTOM INSTRUCTIONS: ${customInstructions}` : ''}

Extract 10-25 numbered sections in the outline. Each section must cover DIFFERENT material.
The sections should form a PROGRESSIVE argument that builds toward the thesis.
Return ONLY the JSON object, no other text.`;

  return { system, user };
}

export function buildChunkPrompt(params: {
  chunkIndex: number;
  totalChunks: number;
  chunkInputText: string;
  chunkInputWords: number;
  targetWords: number;
  lengthMode: string;
  skeleton: GlobalSkeleton;
  assignedSections: string[];
  previousSummary: string;
  topicsCoveredSoFar: string[];
}): { system: string; user: string } {
  const lengthGuidance = getLengthGuidance(params.lengthMode, params.targetWords);
  
  const system = `You are reconstructing chunk ${params.chunkIndex + 1} of ${params.totalChunks} of a document.

GLOBAL SKELETON (you MUST respect this):
THESIS: ${params.skeleton.thesis}
KEY TERMS (use these definitions consistently): ${JSON.stringify(params.skeleton.keyTerms)}
COMMITMENTS: 
- Document asserts: ${params.skeleton.commitmentLedger.asserts.join('; ')}
- Document rejects: ${params.skeleton.commitmentLedger.rejects.join('; ')}

YOUR ASSIGNED SECTIONS FOR THIS CHUNK:
${params.assignedSections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

WHAT HAS ALREADY BEEN WRITTEN (DO NOT REPEAT):
${params.previousSummary || 'This is the first chunk - no previous content.'}

TOPICS ALREADY COVERED (DO NOT REPEAT THESE):
${params.topicsCoveredSoFar.length > 0 ? params.topicsCoveredSoFar.join(', ') : 'None yet - this is the first chunk.'}

${lengthGuidance}

CRITICAL RULES:
1. Cover ONLY your assigned sections - do NOT cover sections assigned to other chunks
2. Do NOT repeat or rehash topics from previous chunks
3. Build progressively on what came before
4. Use key terms consistently as defined
5. Do NOT contradict the commitment ledger`;

  const user = `SOURCE MATERIAL FOR THIS CHUNK:
${params.chunkInputText}

Write chunk ${params.chunkIndex + 1} covering ONLY these sections: ${params.assignedSections.join(', ')}

REMEMBER:
- Target: ${params.targetWords} words (input was ${params.chunkInputWords} words)
- DO NOT repeat content from previous chunks
- Cover ONLY your assigned sections
- Build progressively on previous content

Format your response as:

[CONTENT]
(your content here - must be ~${params.targetWords} words)

[DELTA]
{"newClaims": ["claims introduced in this chunk"], "termsUsed": ["key terms used"], "conflictsDetected": [], "topicsCovered": ["topics covered in this chunk"]}`;

  return { system, user };
}

export function buildRetryPrompt(params: {
  chunkIndex: number;
  originalOutput: string;
  actualWords: number;
  targetWords: number;
  minWords: number;
  assignedSections: string[];
}): { system: string; user: string } {
  const system = `You are expanding a chunk that was too short. 
The chunk needs to be at least ${params.minWords} words but was only ${params.actualWords} words.
Target is ${params.targetWords} words.`;

  const user = `PREVIOUS OUTPUT (${params.actualWords} words - TOO SHORT):
${params.originalOutput}

ASSIGNED SECTIONS: ${params.assignedSections.join(', ')}

TASK: Expand this to at least ${params.minWords} words (target: ${params.targetWords} words).
Add more:
- Concrete examples and illustrations
- Detailed explanations of key concepts
- Implications and consequences
- Historical context where relevant
- Philosophical nuances and distinctions

Do NOT just pad with filler. Add SUBSTANTIVE content.

Format response as:
[CONTENT]
(expanded content - must be ${params.targetWords}+ words)

[DELTA]
{"newClaims": [], "termsUsed": [], "conflictsDetected": [], "topicsCovered": []}`;

  return { system, user };
}

export function buildStitchPrompt(params: {
  skeleton: GlobalSkeleton;
  allDeltas: Array<{ index: number; delta: ChunkDelta }>;
  chunkSummaries: string[];
}): { system: string; user: string } {
  const system = `You analyze cross-chunk coherence. Find contradictions, terminology drift, and redundancies across chunks.`;

  const user = `GLOBAL SKELETON:
${JSON.stringify(params.skeleton, null, 2)}

CHUNK DELTAS (what each chunk covered):
${JSON.stringify(params.allDeltas, null, 2)}

CHUNK SUMMARIES:
${params.chunkSummaries.map((s, i) => `Chunk ${i + 1}: ${s}`).join('\n')}

Analyze for:
1. CONTRADICTIONS: Claims that conflict between chunks
2. REDUNDANCY: Topics repeated unnecessarily across chunks
3. GAPS: Outline sections that weren't covered
4. TERMINOLOGY DRIFT: Key terms used inconsistently

Return JSON:
{
  "conflicts": ["list of contradictions found"],
  "redundancies": ["list of repeated content"],
  "gaps": ["outline sections not covered"],
  "termDrift": ["terms used inconsistently"],
  "repairPlan": ["suggested fixes"]
}`;

  return { system, user };
}

function getLengthGuidance(mode: string, targetWords: number): string {
  const templates: Record<string, string> = {
    heavy_compression: `LENGTH MODE: HEAVY COMPRESSION
Target: ${targetWords} words. Significantly compress while preserving core arguments.
- Remove examples, keep only the most critical one
- Remove repetition and redundancy
- Convert detailed explanations to concise statements`,
    moderate_compression: `LENGTH MODE: MODERATE COMPRESSION
Target: ${targetWords} words. Compress while preserving argument structure.
- Keep the strongest 1-2 examples
- Tighten prose without losing meaning`,
    maintain: `LENGTH MODE: MAINTAIN LENGTH
Target: ${targetWords} words. Similar length to input.
- Improve clarity and coherence
- Replace weak examples with stronger ones`,
    moderate_expansion: `LENGTH MODE: MODERATE EXPANSION
Target: ${targetWords} words. Expand with substantive additions.
- Add 1-2 supporting examples for key claims
- Elaborate on implications of major points`,
    heavy_expansion: `LENGTH MODE: HEAVY EXPANSION
Target: ${targetWords} words. You MUST significantly expand.
- Add 2-3 concrete examples (historical, empirical, hypothetical)
- Elaborate on EACH major claim with supporting analysis
- Add relevant context and background
- Develop implications and consequences
- Do NOT add filler - all additions must be substantive
- You MUST write approximately ${targetWords} words`
  };
  return templates[mode] || templates.maintain;
}

export function summarizeChunk(content: string, maxLength: number = 200): string {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  let summary = '';
  for (const sentence of sentences.slice(0, 3)) {
    if (summary.length + sentence.length < maxLength) {
      summary += sentence.trim() + '. ';
    }
  }
  return summary.trim() || content.slice(0, maxLength) + '...';
}
