// server/PhilosopherCoherenceService.ts
// Extended coherence service supporting multiple generation modes

import OpenAI from "openai";
import { db } from "./db";
import {
  coherentSessions,
  coherentChunks,
  stitchResults,
} from "../shared/schema";
import { eq, asc } from "drizzle-orm";

// Lazy initialization to avoid crash if API key not set at startup
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const LONG_THRESHOLD_WORDS = 1000;
const CHUNK_PAUSE_MS = 15000;
const MAX_WORDS_PER_CHUNK = 1400;
const MAX_CHUNK_RETRIES = 3;

// Supported generation modes
export type CoherenceMode = 'chat' | 'dialogue' | 'modelBuilder' | 'interview' | 'debate';

interface ThinkerMaterial {
  quotes: string[];
  positions: string[];
  arguments: string[];
  chunks: string[];
  deductions: string;
}

interface DebateConfig {
  thinker1: string;
  thinker2: string;
  thinker1Material: ThinkerMaterial;
  thinker2Material: ThinkerMaterial;
}

interface DialogueConfig {
  thinker1: string;
  thinker2?: string; // Optional for philosopher-everyman dialogues
  isEveryman?: boolean;
}

interface InterviewConfig {
  thinker: string;
  interviewerTone: 'neutral' | 'dialectical' | 'hostile';
  mode: 'conservative' | 'aggressive';
}

interface Skeleton {
  mode: CoherenceMode;
  thinker: string;
  thinker2?: string;
  coreThesis: string;
  mainPositions: string[];
  keyTerms: Record<string, string>;
  commitments: string[];
  allowedTopics: string[];
  forbiddenTopics: string[];
  structuralRequirements: string[];
  mustReferenceEarlier: boolean;
  requiresBalance: boolean;
  totalTargetWords: number;
  wordsPerChunk: number;
  logicalSections: string[];
  speakerPattern?: string[]; // For dialogue/debate: alternating speakers
}

interface ChunkPlan {
  index: number;
  sectionIndex: number;
  position: "first" | "middle" | "final";
  targetWords: number;
  section: string;
  speaker?: string; // For dialogue/debate modes
}

interface ChunkDelta {
  addedConcepts: string[];
  resolvedTensions: string[];
  bridgesToNext: string[];
  crossReferences?: string[]; // For debate: references to opponent's points
}

interface StreamEvent {
  type: "status" | "skeleton" | "chunk" | "pause" | "stitch" | "repair" | "complete" | "error";
  data?: any;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

async function callLLM(systemPrompt: string, userPrompt: string, expectJson = false, maxTokens = 4096): Promise<string> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.35,
      max_tokens: maxTokens,
      response_format: expectJson ? { type: "json_object" } : undefined,
    });
    return response.choices[0].message.content || "";
  } catch (err) {
    console.error("LLM error:", err);
    throw err;
  }
}

async function safeParseJson(text: string): Promise<any> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return {};
  }
}

export class PhilosopherCoherenceService {

  async *generateLongResponse(
    thinker: string,
    userQuery: string,
    targetWords: number = 3000,
    material: ThinkerMaterial,
    mode: CoherenceMode = 'chat',
    config?: DebateConfig | DialogueConfig | InterviewConfig
  ): AsyncGenerator<StreamEvent> {
    if (targetWords <= LONG_THRESHOLD_WORDS) {
      yield { type: "status", data: "Short response - not using coherence service" };
      yield { type: "error", data: "Use standard response for < 1000 words" };
      return;
    }

    console.log(`[Coherence Service] Mode: ${mode}, Target: ${targetWords} words`);

    const sessionId = await this.createSession(thinker, userQuery, targetWords, mode);

    yield { type: "status", data: `Building ${mode} skeleton...` };

    const deductions = material.deductions || "";
    const skeleton = await this.buildSkeleton(thinker, userQuery, material, deductions, targetWords, mode, config);

    await db.update(coherentSessions)
      .set({ 
        skeleton: skeleton as any,
        status: "skeleton_complete",
        totalChunks: Math.max(2, Math.ceil(targetWords / MAX_WORDS_PER_CHUNK))
      })
      .where(eq(coherentSessions.id, sessionId));

    yield { type: "skeleton", data: { mode, sections: skeleton.logicalSections.length } };

    const numChunks = Math.max(2, Math.ceil(targetWords / MAX_WORDS_PER_CHUNK));
    const plans = this.buildChunkPlans(skeleton, numChunks, mode);

    const allDeltas: ChunkDelta[] = [];
    const allOutputs: string[] = [];

    yield { type: "status", data: `Generating ${mode} chunks...` };

    for (const plan of plans) {
      yield { type: "status", data: `${mode} chunk ${plan.index + 1}/${numChunks}${plan.speaker ? ` (${plan.speaker})` : ''}` };

      const content = await this.processChunk(
        sessionId,
        plan,
        thinker,
        userQuery,
        material,
        deductions,
        skeleton,
        allOutputs,
        mode,
        config
      );

      allOutputs.push(content);
      
      const delta: ChunkDelta = {
        addedConcepts: [],
        resolvedTensions: [],
        bridgesToNext: [],
        crossReferences: mode === 'debate' ? [] : undefined
      };
      allDeltas.push(delta);

      await db.update(coherentSessions)
        .set({ completedChunks: plan.index + 1 })
        .where(eq(coherentSessions.id, sessionId));

      yield { type: "chunk", data: { index: plan.index, mode, preview: content.substring(0, 200) + "..." } };

      if (plan.index < plans.length - 1) {
        yield { type: "pause", data: { seconds: CHUNK_PAUSE_MS / 1000 } };
        await new Promise(r => setTimeout(r, CHUNK_PAUSE_MS));
      }
    }

    yield { type: "status", data: `Stitching ${mode} output...` };
    const stitchedContent = await this.stitchAndRepair(sessionId, skeleton, thinker, allOutputs, allDeltas, mode, config);

    await db.update(coherentSessions)
      .set({ status: "completed" })
      .where(eq(coherentSessions.id, sessionId));

    yield { type: "complete", data: { output: stitchedContent, words: countWords(stitchedContent), mode } };
  }

  private async createSession(thinker: string, query: string, targetWords: number, mode: CoherenceMode): Promise<string> {
    const [s] = await db.insert(coherentSessions).values({
      thinker,
      topic: `[${mode.toUpperCase()}] ${query.substring(0, 480)}`,
      status: "pending",
      totalChunks: 0,
      completedChunks: 0,
    }).returning({ id: coherentSessions.id });
    return s.id;
  }

  private async buildSkeleton(
    thinker: string,
    query: string,
    material: ThinkerMaterial,
    deductions: string,
    targetWords: number,
    mode: CoherenceMode,
    config?: DebateConfig | DialogueConfig | InterviewConfig
  ): Promise<Skeleton> {
    const grounding = [
      ...material.quotes.slice(0, 15),
      ...material.positions.slice(0, 10),
      ...material.arguments.slice(0, 10),
      ...material.chunks.slice(0, 8)
    ].join("\n\n").substring(0, 12000);

    let modeInstructions = '';
    let speakerPattern: string[] = [];
    let thinker2 = '';

    switch (mode) {
      case 'dialogue':
        const dialogueConfig = config as DialogueConfig;
        thinker2 = dialogueConfig?.thinker2 || 'Everyman';
        speakerPattern = [thinker, thinker2];
        modeInstructions = `
MODE: DIALOGUE
Format as a philosophical dialogue between ${thinker} and ${thinker2}.
Each turn should be grounded in the speaker's documented positions.
${dialogueConfig?.isEveryman ? 'Everyman asks clarifying questions and raises common-sense objections.' : 'Both speakers engage from their authentic philosophical perspectives.'}
logicalSections should alternate between speakers: ["${thinker} Opening", "${thinker2} Response", "${thinker} Elaboration", ...]`;
        break;

      case 'interview':
        const interviewConfig = config as InterviewConfig;
        speakerPattern = ['INTERVIEWER', thinker];
        modeInstructions = `
MODE: INTERVIEW
Format as a structured interview with ${thinker}.
INTERVIEWER: asks questions with ${interviewConfig?.interviewerTone || 'neutral'} tone
${thinker.toUpperCase()}: responds grounded in their documented positions
Mode: ${interviewConfig?.mode || 'conservative'} - ${interviewConfig?.mode === 'aggressive' ? 'extend views to new topics' : 'stick to documented positions'}
logicalSections: ["Opening Question", "Core Philosophy", "Key Concepts", "Challenges", "Conclusion"]`;
        break;

      case 'debate':
        const debateConfig = config as DebateConfig;
        thinker2 = debateConfig?.thinker2 || 'Opponent';
        speakerPattern = [thinker, thinker2];
        modeInstructions = `
MODE: DEBATE
Format as an intellectual debate between ${thinker} and ${thinker2}.
Each speaker DIRECTLY ADDRESSES the other using "you".
Include cross-references to opponent's points.
requiresBalance: true - both speakers get equal time and fair representation.
logicalSections: ["${thinker} Opening", "${thinker2} Opening", "Exchange 1", "Exchange 2", "Exchange 3", "Final Statements"]`;
        break;

      case 'modelBuilder':
        modeInstructions = `
MODE: MODEL BUILDER (Model-Theoretic Analysis)
Analyze the philosophical theory using formal model theory.
Identify primitives, structure, truth conditions.
Classify: LITERALLY TRUE, TRUE UNDER REINTERPRETATION, or INCOHERENT.
logicalSections: ["Theory Parsing", "Literal Analysis", "Model Construction", "Validation", "Summary"]`;
        break;

      default: // 'chat'
        modeInstructions = `
MODE: PHILOSOPHICAL PAPER/RESPONSE
Write as ${thinker} in first person.
Ground all claims in the provided material.

CRITICAL STYLE REQUIREMENTS:
- SHORT PARAGRAPHS (2-4 sentences max)
- Punchy, direct sentences - no academic bloat
- First person voice throughout
- NO hedging ("perhaps", "might", "could be said")
- NO throat-clearing ("This paper will explore...")
- State thesis IMMEDIATELY in first sentences
- Attack the problem directly

logicalSections: ["Thesis Statement", "Core Argument 1", "Core Argument 2", "Implications", "Conclusion"]`;
    }

    const system = `
You are extracting the skeleton for a long ${mode} response${thinker2 ? ` involving ${thinker} and ${thinker2}` : ` as ${thinker}`}.
Use ONLY the provided material. Do NOT invent anything.

${modeInstructions}

GROUNDING MATERIAL:
${grounding}

DEDUCTIONS:
${deductions || "None"}

Return EXACT JSON only:
{
  "mode": "${mode}",
  "thinker": "${thinker}",
  ${thinker2 ? `"thinker2": "${thinker2}",` : ''}
  "coreThesis": "One sentence central idea",
  "mainPositions": ["pos1", "pos2", ...],
  "keyTerms": {"term": "def", ...},
  "commitments": ["assert X", "reject Y", ...],
  "allowedTopics": ["topic1", ...],
  "forbiddenTopics": ["modern politics", "AI", ...],
  "structuralRequirements": ["${mode === 'interview' ? 'INTERVIEWER:/THINKER: format' : 'first-person voice'}", ...],
  "mustReferenceEarlier": ${mode === 'debate' ? 'true' : 'false'},
  "requiresBalance": ${mode === 'debate' ? 'true' : 'false'},
  "totalTargetWords": ${targetWords},
  "wordsPerChunk": ${Math.floor(targetWords / 4)},
  "logicalSections": [...],
  "speakerPattern": ${JSON.stringify(speakerPattern)}
}
`;

    const raw = await callLLM(system, query, true);
    const parsed = await safeParseJson(raw);

    return {
      mode,
      thinker,
      thinker2: parsed.thinker2 || thinker2 || undefined,
      coreThesis: parsed.coreThesis || "Core thesis from material",
      mainPositions: parsed.mainPositions || [],
      keyTerms: parsed.keyTerms || {},
      commitments: parsed.commitments || [],
      allowedTopics: parsed.allowedTopics || [],
      forbiddenTopics: parsed.forbiddenTopics || ["modern politics", "AI", "climate"],
      structuralRequirements: parsed.structuralRequirements || ["first-person", "formal"],
      mustReferenceEarlier: parsed.mustReferenceEarlier ?? (mode === 'debate'),
      requiresBalance: parsed.requiresBalance ?? (mode === 'debate'),
      totalTargetWords: targetWords,
      wordsPerChunk: parsed.wordsPerChunk || 1200,
      logicalSections: parsed.logicalSections || ["Introduction", "Core Argument", "Conclusion"],
      speakerPattern: parsed.speakerPattern || speakerPattern
    };
  }

  private buildChunkPlans(skeleton: Skeleton, numChunks: number, mode: CoherenceMode): ChunkPlan[] {
    const plans: ChunkPlan[] = [];
    const sectionCount = skeleton.logicalSections.length;
    const speakers = skeleton.speakerPattern || [skeleton.thinker];

    for (let i = 0; i < numChunks; i++) {
      const position = i === 0 ? "first" : i === numChunks - 1 ? "final" : "middle";
      const sectionIdx = Math.floor((i / numChunks) * sectionCount);
      const section = skeleton.logicalSections[sectionIdx] || `Part ${i + 1}`;
      
      // For dialogue/interview/debate modes, assign speakers
      const speaker = (mode === 'dialogue' || mode === 'interview' || mode === 'debate')
        ? speakers[i % speakers.length]
        : undefined;

      plans.push({ 
        index: i, 
        sectionIndex: sectionIdx,
        position, 
        targetWords: skeleton.wordsPerChunk, 
        section,
        speaker
      });
    }
    return plans;
  }

  private async processChunk(
    sessionId: string,
    plan: ChunkPlan,
    thinker: string,
    userQuery: string,
    material: ThinkerMaterial,
    deductions: string,
    skeleton: Skeleton,
    priorOutputs: string[],
    mode: CoherenceMode,
    config?: DebateConfig | DialogueConfig | InterviewConfig
  ): Promise<string> {
    const prior = priorOutputs.length > 0
      ? priorOutputs.map((o, i) => `Chunk ${i + 1}: ${o.substring(0, 300)}...`).join("\n")
      : "First chunk.";

    // Get appropriate grounding based on mode
    let grounding = '';
    if (mode === 'debate' && config) {
      const debateConfig = config as DebateConfig;
      const isFirstSpeaker = plan.speaker === thinker;
      const speakerMaterial = isFirstSpeaker ? debateConfig.thinker1Material : debateConfig.thinker2Material;
      grounding = [
        "QUOTES:", ...speakerMaterial.quotes.slice(0, 8),
        "POSITIONS:", ...speakerMaterial.positions.slice(0, 6),
        "CHUNKS:", ...speakerMaterial.chunks.slice(0, 4)
      ].join("\n").substring(0, 6000);
    } else {
      grounding = [
        "QUOTES:", ...material.quotes.slice(0, 10),
        "POSITIONS:", ...material.positions.slice(0, 8),
        "ARGUMENTS:", ...material.arguments.slice(0, 8),
        "CHUNKS:", ...material.chunks.slice(0, 5)
      ].join("\n").substring(0, 8000);
    }

    let modePrompt = '';
    switch (mode) {
      case 'dialogue':
        modePrompt = `Write dialogue turns. Current speaker focus: ${plan.speaker}.
Format: ${skeleton.thinker.toUpperCase()}: [text] and ${skeleton.thinker2?.toUpperCase()}: [text]
Include 2-3 exchanges in this chunk. Each turn grounded in speaker's positions.`;
        break;

      case 'interview':
        modePrompt = `Write interview exchanges. 
Format: INTERVIEWER: [question] followed by ${thinker.toUpperCase()}: [response]
Include 2-3 Q&A exchanges. Responses grounded in documented positions.`;
        break;

      case 'debate':
        modePrompt = `Write debate exchange. Current speaker: ${plan.speaker}.
Format: ${skeleton.thinker.toUpperCase()}: [text] and ${skeleton.thinker2?.toUpperCase()}: [text]
CRITICAL: Address opponent directly with "you" not third person.
Reference and challenge opponent's prior points.`;
        break;

      case 'modelBuilder':
        modePrompt = `Analyze the theory section: ${plan.section}.
Use formal model-theoretic language.
Identify primitives, structures, and truth conditions.`;
        break;

      default: // 'chat'
        modePrompt = `Write as ${thinker} in first person.
Advance thesis coherently using exact terms/positions from grounding.`;
    }

    const system = `
You are generating ${mode} content - chunk ${plan.index + 1}.
Position: ${plan.position.toUpperCase()}
Section: ${plan.section}
Target: ~${plan.targetWords} words
${plan.speaker ? `Speaker focus: ${plan.speaker}` : ''}

SKELETON (NEVER VIOLATE):
${JSON.stringify(skeleton, null, 2)}

GROUNDING (ONLY SOURCE):
${grounding}

DEDUCTIONS:
${deductions}

PRIOR CHUNKS:
${prior}

OVERALL QUERY:
${userQuery}

${modePrompt}

${skeleton.mustReferenceEarlier && plan.position === 'final' ? 'FINAL CHUNK: Reference and synthesize earlier points.' : ''}
${skeleton.requiresBalance ? 'BALANCE: Give equal representation to all speakers.' : ''}

Output ONLY the chunk content.
`;

    let content = "";
    let retries = 0;

    while (retries < MAX_CHUNK_RETRIES && content.length < 300) {
      content = await callLLM(system, "Write this chunk.", false);
      retries++;
    }

    const delta: ChunkDelta = {
      addedConcepts: [],
      resolvedTensions: [],
      bridgesToNext: [],
      crossReferences: mode === 'debate' ? [] : undefined
    };

    await db.insert(coherentChunks).values({
      sessionId,
      sectionIndex: plan.sectionIndex,
      chunkIndex: plan.index,
      content,
      delta: delta as any,
    });

    return content;
  }

  private async stitchAndRepair(
    sessionId: string,
    skeleton: Skeleton,
    thinker: string,
    allOutputs: string[],
    allDeltas: ChunkDelta[],
    mode: CoherenceMode,
    config?: DebateConfig | DialogueConfig | InterviewConfig
  ): Promise<string> {
    const combined = allOutputs.join("\n\n");

    let stitchInstructions = '';
    switch (mode) {
      case 'dialogue':
        stitchInstructions = `Stitch into seamless philosophical dialogue.
Ensure natural flow between turns.
Format: ${skeleton.thinker.toUpperCase()}: and ${skeleton.thinker2?.toUpperCase()}:
Remove redundant exchanges. Ensure each speaker has substantive contributions.`;
        break;

      case 'interview':
        stitchInstructions = `Stitch into coherent interview.
Format: INTERVIEWER: and ${thinker.toUpperCase()}:
Ensure logical progression of questions.
Remove redundant Q&A pairs.`;
        break;

      case 'debate':
        stitchInstructions = `Stitch into balanced debate.
Format: ${skeleton.thinker.toUpperCase()}: and ${skeleton.thinker2?.toUpperCase()}:
CRITICAL: Both speakers must address each other directly with "you".
Ensure equal representation. Maintain intellectual tension.
Verify cross-references to opponent's points are accurate.`;
        break;

      case 'modelBuilder':
        stitchInstructions = `Stitch into coherent model-theoretic analysis.
Ensure logical flow from parsing to validation.
Maintain formal precision throughout.`;
        break;

      default:
        stitchInstructions = `Combine into seamless document.
Maintain ${thinker}'s voice throughout.
Fix flow, remove repetitions.`;
    }

    const stitchSystem = `
Final editor for ${mode} output${skeleton.thinker2 ? ` between ${thinker} and ${skeleton.thinker2}` : ''}.

${stitchInstructions}

SKELETON:
${JSON.stringify(skeleton, null, 2)}

CHUNKS PREVIEW:
${allOutputs.map((o, i) => `Chunk ${i+1}: ${o.substring(0, 800)}...`).join("\n\n")}

DELTAS:
${JSON.stringify(allDeltas, null, 2)}

Honor skeleton. Output ONLY final text.
`;

    let stitchedContent = await callLLM(stitchSystem, "Stitch now.", false, 8000);

    // Repair pass
    for (let i = 0; i < 2; i++) {
      const check = await callLLM(
        `Check for ${mode} issues:\n${stitchedContent.substring(0, 8000)}`,
        `Check for: format violations, speaker imbalance${mode === 'debate' ? ', third-person references (should be "you")' : ''}, contradictions. Say PASS if none.`,
        false
      );
      if (check.includes("PASS")) break;
      stitchedContent = await callLLM(`Repair:\n${check}\nOriginal:\n${stitchedContent.substring(0, 12000)}`, "Fixed version", false, 8000);
    }

    const wordCount = countWords(stitchedContent);

    await db.insert(stitchResults).values({
      sessionId,
      stitchedContent,
      wordCount,
      coherenceScore: 85,
      metadata: {
        processingTimeMs: 0,
        chunksUsed: allOutputs.length,
        model: "gpt-4o",
        mode
      } as any,
    });

    return stitchedContent;
  }
}

export const philosopherCoherenceService = new PhilosopherCoherenceService();
