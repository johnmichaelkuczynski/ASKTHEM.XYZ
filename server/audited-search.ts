import { db } from "./db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

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

export interface PassageCandidate {
  id: string;
  source: 'positions' | 'quotes' | 'chunks';
  text: string;
  topic?: string;
  sourceFile?: string;
  chunkIndex?: number;
}

export interface DirectAnswer {
  passage: PassageCandidate;
  isDirectAnswer: boolean;
  relevanceScore: number;
  reasoning: string;
}

export interface AuditEvent {
  timestamp: number;
  type: 'query' | 'table_search' | 'passage_examined' | 'passage_accepted' | 'passage_rejected' | 
        'direct_answer_found' | 'alignment_check' | 'search_complete' | 'no_direct_answer' | 'error';
  detail: string;
  data?: any;
}

export interface AlignmentResult {
  aligned: boolean;
  conflicting: boolean;
  summary: string;
  conflictDescription?: string;
}

export interface AuditedSearchResult {
  question: string;
  authorId: string;
  authorName: string;
  events: AuditEvent[];
  directAnswers: DirectAnswer[];
  alignmentResult: AlignmentResult | null;
  adjacentMaterial: PassageCandidate[];
  searchComplete: boolean;
  answerType: 'direct_aligned' | 'direct_conflicting' | 'indirect' | 'no_material';
}

export type AuditEventCallback = (event: AuditEvent) => void;

export async function auditedCorpusSearch(
  question: string,
  authorId: string,
  authorName: string,
  onEvent: AuditEventCallback
): Promise<AuditedSearchResult> {
  const events: AuditEvent[] = [];
  const directAnswers: DirectAnswer[] = [];
  const adjacentMaterial: PassageCandidate[] = [];
  
  const emit = (event: Omit<AuditEvent, 'timestamp'>) => {
    const fullEvent: AuditEvent = { ...event, timestamp: Date.now() };
    events.push(fullEvent);
    onEvent(fullEvent);
  };

  emit({ type: 'query', detail: `Starting audited search for author: ${authorName}`, data: { question, authorId } });

  // Map figure IDs to canonical database thinker names
  const authorNameMap: Record<string, string> = {
    "kuczynski": "Kuczynski",
    "freud": "Freud",
    "nietzsche": "Nietzsche",
    "marx": "Marx",
    "berkeley": "George Berkeley",
    "james": "William James",
    "allen": "James Allen",
    "dostoevsky": "Dostoevsky",
    "plato": "Plato",
    "spinoza": "Spinoza",
    "russell": "Russell",
    "galileo": "Galileo",
    "bacon": "Bacon",
    "leibniz": "Leibniz",
    "aristotle": "Aristotle",
    "kant": "Kant",
    "darwin": "Darwin",
    "bergson": "Bergson",
    "schopenhauer": "Schopenhauer",
    "jung": "Jung",
    "aesop": "Aesop",
    "newton": "Newton",
    "goldman": "Emma Goldman",
    "lebon": "Gustave Le Bon",
    "dworkin": "Andrea Dworkin",
    "whewell": "William Whewell",
    "hegel": "Hegel",
    "hume": "Hume",
    "locke": "Locke",
    "hobbes": "Hobbes",
    "descartes": "Descartes",
    "voltaire": "Voltaire",
    "rousseau": "Rousseau",
    "tocqueville": "Tocqueville",
    "smith": "Adam Smith",
    "mises": "Mises",
    "veblen": "Veblen",
    "poe": "Poe",
    "dewey": "Dewey",
    "reich": "Wilhelm Reich",
    "adler": "Adler",
    "confucius": "Confucius",
    "engels": "Engels",
    "gardner": "Martin Gardner"
  };
  
  // Use mapped name for database queries, fall back to authorName or authorId
  const dbThinkerName = authorNameMap[authorId.toLowerCase()] || authorName || authorId;

  try {
    // STEP 1: Search POSITIONS table first
    emit({ type: 'table_search', detail: 'Searching POSITIONS table...', data: { table: 'positions' } });
    
    const positionsQuery = sql`
      SELECT id::text, thinker, position_text, topic 
      FROM positions 
      WHERE thinker ILIKE ${'%' + dbThinkerName + '%'}
      ORDER BY RANDOM()
      LIMIT 30
    `;
    emit({ type: 'query', detail: `SQL: SELECT FROM positions WHERE thinker ILIKE '%${dbThinkerName}%'`, data: { sql: positionsQuery.toString() } });
    
    const positionsResult = await db.execute(positionsQuery);
    const positions = (positionsResult.rows || []) as Array<{id: string, thinker: string, position_text: string, topic: string | null}>;
    
    emit({ type: 'table_search', detail: `Found ${positions.length} position statements`, data: { count: positions.length } });

    // Examine each position for direct answers
    for (const pos of positions) {
      const candidate: PassageCandidate = {
        id: pos.id,
        source: 'positions',
        text: pos.position_text,
        topic: pos.topic || undefined
      };
      
      emit({ type: 'passage_examined', detail: `Examining position: "${pos.position_text.substring(0, 80)}..."`, data: { id: pos.id, topic: pos.topic } });
      
      // Use LLM to judge if this is a direct answer
      const judgment = await judgeDirectAnswer(question, candidate.text);
      
      if (judgment.isDirectAnswer && judgment.relevanceScore >= 0.7) {
        directAnswers.push({ passage: candidate, ...judgment });
        emit({ type: 'direct_answer_found', detail: `DIRECT ANSWER #${directAnswers.length}: "${pos.position_text.substring(0, 100)}..."`, data: { answerNumber: directAnswers.length, reasoning: judgment.reasoning } });
        
        if (directAnswers.length >= 3) break;
      } else {
        emit({ type: 'passage_rejected', detail: `Rejected: ${judgment.reasoning}`, data: { id: pos.id, reason: judgment.reasoning } });
        adjacentMaterial.push(candidate);
      }
    }

    // STEP 2: If we don't have 3 direct answers, search QUOTES table
    if (directAnswers.length < 3) {
      emit({ type: 'table_search', detail: 'Searching QUOTES table...', data: { table: 'quotes' } });
      
      const quotesQuery = sql`
        SELECT id::text, thinker, quote_text, topic 
        FROM quotes 
        WHERE thinker ILIKE ${'%' + dbThinkerName + '%'}
        ORDER BY RANDOM()
        LIMIT 30
      `;
      emit({ type: 'query', detail: `SQL: SELECT FROM quotes WHERE thinker ILIKE '%${dbThinkerName}%'`, data: { sql: quotesQuery.toString() } });
      
      const quotesResult = await db.execute(quotesQuery);
      const quotes = (quotesResult.rows || []) as Array<{id: string, thinker: string, quote_text: string, topic: string | null}>;
      
      emit({ type: 'table_search', detail: `Found ${quotes.length} quotes`, data: { count: quotes.length } });

      for (const quote of quotes) {
        if (directAnswers.length >= 3) break;
        
        const candidate: PassageCandidate = {
          id: quote.id,
          source: 'quotes',
          text: quote.quote_text,
          topic: quote.topic || undefined
        };
        
        emit({ type: 'passage_examined', detail: `Examining quote: "${quote.quote_text.substring(0, 80)}..."`, data: { id: quote.id } });
        
        const judgment = await judgeDirectAnswer(question, candidate.text);
        
        if (judgment.isDirectAnswer && judgment.relevanceScore >= 0.7) {
          directAnswers.push({ passage: candidate, ...judgment });
          emit({ type: 'direct_answer_found', detail: `DIRECT ANSWER #${directAnswers.length}: "${quote.quote_text.substring(0, 100)}..."`, data: { answerNumber: directAnswers.length, reasoning: judgment.reasoning } });
        } else {
          emit({ type: 'passage_rejected', detail: `Rejected: ${judgment.reasoning}`, data: { id: quote.id, reason: judgment.reasoning } });
          adjacentMaterial.push(candidate);
        }
      }
    }

    // STEP 3: If we still don't have 3 direct answers, search CHUNKS table (full works)
    if (directAnswers.length < 3) {
      emit({ type: 'table_search', detail: 'Searching CHUNKS table (full works)...', data: { table: 'chunks' } });
      
      // Use embedding search for chunks to find semantically relevant content
      const embeddingResponse = await getOpenAI().embeddings.create({
        model: "text-embedding-ada-002",
        input: question,
      });
      const queryEmbedding = embeddingResponse.data[0].embedding;
      
      const chunksQuery = sql`
        SELECT id::text, thinker, chunk_text, source_text_id, chunk_index,
               embedding <=> ${JSON.stringify(queryEmbedding)}::vector as distance
        FROM chunks 
        WHERE thinker ILIKE ${'%' + dbThinkerName + '%'}
          AND embedding IS NOT NULL
        ORDER BY distance
        LIMIT 30
      `;
      emit({ type: 'query', detail: `SQL: SELECT FROM chunks WHERE thinker ILIKE '%${dbThinkerName}%' ORDER BY embedding distance`, data: { table: 'chunks' } });
      
      const chunksResult = await db.execute(chunksQuery);
      const chunks = (chunksResult.rows || []) as Array<{id: string, thinker: string, chunk_text: string, source_text_id: string, chunk_index: number, distance: number}>;
      
      emit({ type: 'table_search', detail: `Found ${chunks.length} chunks from full works`, data: { count: chunks.length } });

      for (const chunk of chunks) {
        if (directAnswers.length >= 3) break;
        
        const candidate: PassageCandidate = {
          id: chunk.id,
          source: 'chunks',
          text: chunk.chunk_text,
          sourceFile: chunk.source_text_id,
          chunkIndex: chunk.chunk_index
        };
        
        emit({ type: 'passage_examined', detail: `Examining chunk from "${chunk.source_text_id}": "${chunk.chunk_text.substring(0, 60)}..."`, data: { id: chunk.id, sourceFile: chunk.source_text_id, distance: chunk.distance } });
        
        const judgment = await judgeDirectAnswer(question, candidate.text);
        
        if (judgment.isDirectAnswer && judgment.relevanceScore >= 0.6) {
          directAnswers.push({ passage: candidate, ...judgment });
          emit({ type: 'direct_answer_found', detail: `DIRECT ANSWER #${directAnswers.length} from "${chunk.source_text_id}"`, data: { answerNumber: directAnswers.length, reasoning: judgment.reasoning } });
        } else {
          emit({ type: 'passage_rejected', detail: `Rejected: ${judgment.reasoning}`, data: { id: chunk.id, reason: judgment.reasoning } });
          if (adjacentMaterial.length < 10) {
            adjacentMaterial.push(candidate);
          }
        }
      }
    }

    // STEP 4: ALIGNMENT CHECK
    let alignmentResult: AlignmentResult | null = null;
    let answerType: AuditedSearchResult['answerType'] = 'no_material';
    
    if (directAnswers.length >= 3) {
      emit({ type: 'alignment_check', detail: 'Checking alignment of 3 direct answers...', data: { count: directAnswers.length } });
      
      alignmentResult = await checkAlignment(question, directAnswers.slice(0, 3));
      
      if (alignmentResult.aligned) {
        emit({ type: 'alignment_check', detail: 'ALIGNED: All 3 answers agree. Proceeding to generate response.', data: alignmentResult });
        answerType = 'direct_aligned';
      } else {
        emit({ type: 'alignment_check', detail: `CONFLICTING: ${alignmentResult.conflictDescription}. Will present all 3 separately.`, data: alignmentResult });
        answerType = 'direct_conflicting';
      }
    } else if (directAnswers.length > 0) {
      emit({ type: 'alignment_check', detail: `Found only ${directAnswers.length} direct answer(s). Using available evidence.`, data: { count: directAnswers.length } });
      answerType = 'direct_aligned';
    } else if (adjacentMaterial.length > 0) {
      emit({ type: 'no_direct_answer', detail: 'No direct answers found. Will use adjacent material cautiously.', data: { adjacentCount: adjacentMaterial.length } });
      answerType = 'indirect';
    } else {
      emit({ type: 'no_direct_answer', detail: 'No relevant material found in corpus.', data: {} });
      answerType = 'no_material';
    }

    emit({ type: 'search_complete', detail: `Search complete. Found ${directAnswers.length} direct answers, ${adjacentMaterial.length} adjacent passages.`, data: { directCount: directAnswers.length, adjacentCount: adjacentMaterial.length, answerType } });

    return {
      question,
      authorId,
      authorName,
      events,
      directAnswers,
      alignmentResult,
      adjacentMaterial: adjacentMaterial.slice(0, 5),
      searchComplete: true,
      answerType
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    emit({ type: 'error', detail: `Search error: ${errorMsg}`, data: { error: errorMsg } });
    
    return {
      question,
      authorId,
      authorName,
      events,
      directAnswers,
      alignmentResult: null,
      adjacentMaterial,
      searchComplete: false,
      answerType: 'no_material'
    };
  }
}

async function judgeDirectAnswer(question: string, passage: string): Promise<{isDirectAnswer: boolean, relevanceScore: number, reasoning: string}> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a strict relevance judge. Given a QUESTION and a PASSAGE, determine:
1. Is this passage a DIRECT answer to the question? (not tangentially related, but directly addresses the question)
2. Relevance score 0.0-1.0 (1.0 = perfectly on-point direct answer)
3. Brief reasoning

Respond ONLY in JSON format:
{"isDirectAnswer": true/false, "relevanceScore": 0.0-1.0, "reasoning": "brief explanation"}`
        },
        {
          role: "user",
          content: `QUESTION: ${question}\n\nPASSAGE: ${passage.substring(0, 1500)}`
        }
      ]
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    return {
      isDirectAnswer: parsed.isDirectAnswer || false,
      relevanceScore: parsed.relevanceScore || 0,
      reasoning: parsed.reasoning || 'Unable to determine'
    };
  } catch (error) {
    return { isDirectAnswer: false, relevanceScore: 0, reasoning: 'Judgment failed' };
  }
}

async function checkAlignment(question: string, answers: DirectAnswer[]): Promise<AlignmentResult> {
  try {
    const answersText = answers.map((a, i) => `Answer ${i + 1}: "${a.passage.text.substring(0, 500)}"`).join('\n\n');
    
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You are an alignment judge. Given a QUESTION and 3 ANSWER passages from the same author, determine:
1. Do these answers ALIGN (say the same thing) or CONFLICT (say different/contradictory things)?
2. If conflicting, briefly describe the conflict.

Be strict: Different aspects of the same view = ALIGNED. Contradictory claims = CONFLICTING.

Respond ONLY in JSON format:
{"aligned": true/false, "conflicting": true/false, "summary": "brief summary", "conflictDescription": "if conflicting, explain"}`
        },
        {
          role: "user",
          content: `QUESTION: ${question}\n\n${answersText}`
        }
      ]
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    return {
      aligned: parsed.aligned || false,
      conflicting: parsed.conflicting || false,
      summary: parsed.summary || '',
      conflictDescription: parsed.conflictDescription
    };
  } catch (error) {
    return { aligned: true, conflicting: false, summary: 'Alignment check failed - treating as aligned' };
  }
}

export function generateAuditReport(result: AuditedSearchResult): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    AUDIT REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Question: ${result.question}`);
  lines.push(`Author: ${result.authorName} (${result.authorId})`);
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`Answer Type: ${result.answerType}`);
  lines.push('');
  
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    EXECUTION TRACE');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');
  
  for (const event of result.events) {
    const time = new Date(event.timestamp).toISOString().substring(11, 23);
    lines.push(`[${time}] ${event.type.toUpperCase()}: ${event.detail}`);
    if (event.data && Object.keys(event.data).length > 0) {
      lines.push(`           Data: ${JSON.stringify(event.data)}`);
    }
  }
  
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    DIRECT ANSWERS FOUND');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');
  
  if (result.directAnswers.length === 0) {
    lines.push('No direct answers found in corpus.');
  } else {
    for (let i = 0; i < result.directAnswers.length; i++) {
      const da = result.directAnswers[i];
      lines.push(`DIRECT ANSWER #${i + 1}`);
      lines.push(`  Source: ${da.passage.source} (ID: ${da.passage.id})`);
      if (da.passage.topic) lines.push(`  Topic: ${da.passage.topic}`);
      if (da.passage.sourceFile) lines.push(`  File: ${da.passage.sourceFile}`);
      lines.push(`  Relevance: ${(da.relevanceScore * 100).toFixed(0)}%`);
      lines.push(`  Reasoning: ${da.reasoning}`);
      lines.push(`  Text: "${da.passage.text.substring(0, 500)}${da.passage.text.length > 500 ? '...' : ''}"`);
      lines.push('');
    }
  }
  
  if (result.alignmentResult) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                    ALIGNMENT CHECK');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');
    lines.push(`Result: ${result.alignmentResult.aligned ? 'ALIGNED' : 'CONFLICTING'}`);
    lines.push(`Summary: ${result.alignmentResult.summary}`);
    if (result.alignmentResult.conflictDescription) {
      lines.push(`Conflict: ${result.alignmentResult.conflictDescription}`);
    }
    lines.push('');
  }
  
  if (result.adjacentMaterial.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                    ADJACENT MATERIAL');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');
    for (const adj of result.adjacentMaterial.slice(0, 5)) {
      lines.push(`[${adj.source}] ${adj.text.substring(0, 200)}...`);
      lines.push('');
    }
  }
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    END OF AUDIT REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

export function buildPromptFromAuditResult(result: AuditedSearchResult): { systemPrompt: string; contextPrompt: string } {
  let systemPrompt = '';
  let contextPrompt = '';
  
  if (result.answerType === 'direct_aligned') {
    systemPrompt = `You are ${result.authorName}. You have been asked a question and your corpus has been searched.
The search found ${result.directAnswers.length} direct answer(s) that ALIGN.

YOUR ROLE IS LIMITED:
- Phrase the answer in your authentic voice
- Use the exact evidence provided below
- Do NOT invent content beyond what is given
- Do NOT smooth over or add qualifications not in the source

Respond as ${result.authorName}, grounding every claim in the passages below.`;

    contextPrompt = `DIRECT ANSWERS FROM YOUR CORPUS:\n\n`;
    for (let i = 0; i < result.directAnswers.length; i++) {
      const da = result.directAnswers[i];
      contextPrompt += `[${da.passage.source.toUpperCase()} ${i + 1}]: "${da.passage.text}"\n\n`;
    }
  } else if (result.answerType === 'direct_conflicting') {
    systemPrompt = `You are ${result.authorName}. You have been asked a question and your corpus has been searched.
The search found ${result.directAnswers.length} direct answers that CONFLICT with each other.

CRITICAL RULE - NO SYNTHESIS:
You must NOT reconcile or smooth over these disagreements.
You must present ALL ${result.directAnswers.length} answers separately and honestly.
Say: "I found different answers in my work. Here they are."

Do NOT invent a unified position. Present the conflict truthfully.`;

    contextPrompt = `CONFLICTING ANSWERS FROM YOUR CORPUS:\n\n`;
    for (let i = 0; i < result.directAnswers.length; i++) {
      const da = result.directAnswers[i];
      contextPrompt += `[ANSWER ${i + 1} - ${da.passage.source}]: "${da.passage.text}"\n\n`;
    }
    if (result.alignmentResult?.conflictDescription) {
      contextPrompt += `CONFLICT DESCRIPTION: ${result.alignmentResult.conflictDescription}\n\n`;
    }
  } else if (result.answerType === 'indirect') {
    systemPrompt = `You are ${result.authorName}. You have been asked a question and your corpus has been searched.
Related material is available below.

YOUR ROLE:
- Answer the question directly as ${result.authorName} would
- Use your characteristic voice and philosophical framework
- Draw on the related material to inform your answer
- NO disclaimers about what is or isn't in the corpus
- NO hedge sentences like "While I haven't directly addressed..."
- Just answer authentically. If you're wrong, you're wrong.`;

    contextPrompt = `RELATED MATERIAL FROM YOUR CORPUS:\n\n`;
    for (const adj of result.adjacentMaterial) {
      contextPrompt += `[${adj.source}]: "${adj.text.substring(0, 800)}"\n\n`;
    }
  } else {
    // NO_MATERIAL: Use LLM knowledge as fallback - no disclaimers
    systemPrompt = `You are ${result.authorName}. Answer this question directly.

YOUR ROLE:
- Answer as ${result.authorName} would, using your philosophical framework
- Use your characteristic voice, rhetoric, and reasoning style  
- NO disclaimers about what is or isn't in any database or corpus
- NO hedge sentences like "While I haven't addressed this..."
- Just answer directly. If you're wrong, you're wrong.

Answer the question as ${result.authorName}.`;
    contextPrompt = ``;
  }
  
  return { systemPrompt, contextPrompt };
}
