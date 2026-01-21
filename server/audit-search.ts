import { AuditStep, PassageResult, DirectAnswer, AlignmentResult, AuditReport, LLMUsage } from '../shared/audit-types';
import { searchPhilosophicalChunks, searchTextChunks, searchPositions, StructuredChunk, TextChunkResult, StructuredPosition } from './vector-search';
import { v4 as uuidv4 } from 'uuid';

export class AuditTracker {
  private steps: AuditStep[] = [];
  private queriesExecuted: AuditReport['queriesExecuted'] = [];
  private tablesSearched: string[] = [];
  private passagesExamined: PassageResult[] = [];
  private directAnswersFound: DirectAnswer[] = [];
  private alignmentResult: AlignmentResult | null = null;
  private llmUsage: LLMUsage | null = null;
  
  private question: string;
  private authorId: string;
  private authorName: string;
  private startTime: number;
  
  private onStep?: (step: AuditStep) => void;
  
  constructor(question: string, authorId: string, authorName: string, onStep?: (step: AuditStep) => void) {
    this.question = question;
    this.authorId = authorId;
    this.authorName = authorName;
    this.startTime = Date.now();
    this.onStep = onStep;
  }
  
  addStep(type: AuditStep['type'], detail: string, data?: Record<string, unknown>) {
    const step: AuditStep = {
      timestamp: Date.now(),
      type,
      detail,
      data
    };
    this.steps.push(step);
    if (this.onStep) {
      this.onStep(step);
    }
  }
  
  recordQuery(queryText: string, table: string, parameters: Record<string, unknown>, resultCount: number) {
    this.queriesExecuted.push({ queryText, table, parameters, resultCount });
    if (!this.tablesSearched.includes(table)) {
      this.tablesSearched.push(table);
    }
    this.addStep('query', `Searched ${table}: ${resultCount} results`, { queryText, table, resultCount });
  }
  
  recordPassage(passage: PassageResult) {
    this.passagesExamined.push(passage);
    const stepType = passage.accepted ? 'passage_found' : 'passage_rejected';
    this.addStep(stepType, passage.accepted 
      ? `Found relevant passage from ${passage.source}` 
      : `Rejected passage: ${passage.rejectionReason}`, 
      { passageId: passage.id, source: passage.source, similarity: passage.similarity }
    );
  }
  
  recordDirectAnswer(answer: DirectAnswer) {
    this.directAnswersFound.push(answer);
    this.addStep('direct_answer', `Direct answer #${this.directAnswersFound.length} found from ${answer.source}`, {
      passageId: answer.passageId,
      source: answer.source
    });
  }
  
  recordAlignment(result: AlignmentResult) {
    this.alignmentResult = result;
    this.addStep('alignment_check', result.summary, {
      aligned: result.aligned,
      conflicting: result.conflicting,
      noDirectAnswer: result.noDirectAnswer
    });
  }
  
  recordLLMUsage(usage: LLMUsage) {
    this.llmUsage = usage;
    this.addStep('llm_call', `LLM call to ${usage.model}`, {
      model: usage.model,
      tokenCount: usage.tokenCount
    });
  }
  
  recordFinalDecision(faithfulness: AuditReport['faithfulnessNote'], answer: string) {
    this.addStep('final_decision', `Response generated: ${faithfulness}`, { faithfulness });
  }
  
  generateReport(finalAnswer: string, faithfulness: AuditReport['faithfulnessNote']): AuditReport {
    return {
      id: uuidv4(),
      timestamp: this.startTime,
      question: this.question,
      authorId: this.authorId,
      authorName: this.authorName,
      executionTrace: this.steps,
      queriesExecuted: this.queriesExecuted,
      tablesSearched: this.tablesSearched,
      passagesExamined: this.passagesExamined,
      directAnswersFound: this.directAnswersFound,
      alignmentResult: this.alignmentResult || {
        aligned: false,
        conflicting: false,
        noDirectAnswer: true,
        summary: 'No alignment check performed'
      },
      llmUsage: this.llmUsage || {
        model: 'unknown',
        promptBlocks: { system: '', user: '', retrievedContext: '' }
      },
      finalAnswer,
      faithfulnessNote: faithfulness
    };
  }
  
  getSteps(): AuditStep[] {
    return this.steps;
  }
  
  getDirectAnswers(): DirectAnswer[] {
    return this.directAnswersFound;
  }
  
  getPassages(): PassageResult[] {
    return this.passagesExamined;
  }
}

export interface AuditedSearchResult {
  chunks: StructuredChunk[];
  textChunks: TextChunkResult[];
  positions: StructuredPosition[];
  directAnswers: DirectAnswer[];
  alignmentResult: AlignmentResult;
  tracker: AuditTracker;
}

export async function auditedSearch(
  question: string,
  authorId: string,
  authorName: string,
  onStep?: (step: AuditStep) => void
): Promise<AuditedSearchResult> {
  const tracker = new AuditTracker(question, authorId, authorName, onStep);
  
  tracker.addStep('query', `Starting search for author: ${authorName}`, { authorId, question });
  
  // STEP 1: Search positions table
  tracker.addStep('table_search', 'Searching positions table...', { table: 'positions' });
  const keywords = question.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);
  
  const positions = await searchPositions(authorId, keywords, 15);
  tracker.recordQuery(
    `SELECT * FROM positions WHERE thinker ILIKE '%${authorId}%' AND (topic/position_text matches keywords)`,
    'positions',
    { authorId, keywords },
    positions.length
  );
  
  // Record each position as a passage
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const passageResult: PassageResult = {
      id: `pos-${i}`,
      source: 'positions',
      workTitle: pos.topic,
      text: pos.position,
      similarity: 1.0, // Keyword match, not vector
      accepted: true
    };
    tracker.recordPassage(passageResult);
  }
  
  // STEP 2: Search text chunks table
  tracker.addStep('table_search', 'Searching text chunks table...', { table: 'chunks' });
  const textChunks = await searchTextChunks(authorId, question, 10);
  tracker.recordQuery(
    `SELECT * FROM chunks WHERE thinker ILIKE '%${authorId}%' AND chunk_text matches keywords`,
    'chunks (keyword)',
    { authorId, question },
    textChunks.length
  );
  
  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    const passageResult: PassageResult = {
      id: `text-${i}`,
      source: 'chunks',
      workTitle: chunk.sourceFile,
      chunkIndex: chunk.chunkIndex,
      text: chunk.chunkText.substring(0, 500) + (chunk.chunkText.length > 500 ? '...' : ''),
      similarity: 0.8, // Keyword match
      accepted: true
    };
    tracker.recordPassage(passageResult);
  }
  
  // STEP 3: Vector search on chunks
  tracker.addStep('table_search', 'Performing vector similarity search...', { table: 'chunks (vector)' });
  const chunks = await searchPhilosophicalChunks(question, 15, 'common', authorId);
  tracker.recordQuery(
    `SELECT * FROM chunks WHERE thinker ILIKE '%${authorId}%' ORDER BY embedding <=> query_embedding LIMIT 15`,
    'chunks (vector)',
    { authorId, question },
    chunks.length
  );
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const passageResult: PassageResult = {
      id: `vec-${i}`,
      source: 'chunks (vector)',
      workTitle: chunk.paperTitle,
      chunkIndex: chunk.chunkIndex,
      text: chunk.content.substring(0, 500) + (chunk.content.length > 500 ? '...' : ''),
      similarity: 1 - chunk.distance, // Convert distance to similarity
      accepted: chunk.distance < 0.5 // Accept if reasonably similar
    };
    if (!passageResult.accepted) {
      passageResult.rejectionReason = `Low similarity: ${(1 - chunk.distance).toFixed(3)}`;
    }
    tracker.recordPassage(passageResult);
  }
  
  // STEP 4: Identify direct answers (passages with high relevance)
  const allPassages = tracker.getPassages().filter(p => p.accepted);
  const directAnswerCandidates = allPassages
    .filter(p => p.similarity > 0.6)
    .slice(0, 5);
  
  const directAnswers: DirectAnswer[] = directAnswerCandidates.map(p => ({
    passageId: p.id,
    text: p.text,
    source: p.source,
    workTitle: p.workTitle
  }));
  
  for (const da of directAnswers) {
    tracker.recordDirectAnswer(da);
  }
  
  // STEP 5: Check alignment
  let alignmentResult: AlignmentResult;
  
  if (directAnswers.length === 0) {
    alignmentResult = {
      aligned: false,
      conflicting: false,
      noDirectAnswer: true,
      summary: 'No direct answers found - will use adjacent material cautiously'
    };
  } else if (directAnswers.length < 3) {
    alignmentResult = {
      aligned: true, // Proceed with what we have
      conflicting: false,
      noDirectAnswer: false,
      summary: `Found ${directAnswers.length} direct answer(s) - proceeding with available material`
    };
  } else {
    // Have 3+ answers - alignment will be determined by LLM during response
    alignmentResult = {
      aligned: true, // Tentatively aligned, LLM will verify
      conflicting: false,
      noDirectAnswer: false,
      summary: `Found ${directAnswers.length} direct answers - LLM will check alignment during response generation`
    };
  }
  
  tracker.recordAlignment(alignmentResult);
  
  return {
    chunks,
    textChunks,
    positions,
    directAnswers,
    alignmentResult,
    tracker
  };
}

export function formatAuditReportAsText(report: AuditReport): string {
  let text = `
═══════════════════════════════════════════════════════════════
                    AUDIT REPORT
═══════════════════════════════════════════════════════════════

QUESTION: ${report.question}
AUTHOR: ${report.authorName} (${report.authorId})
TIMESTAMP: ${new Date(report.timestamp).toISOString()}
REPORT ID: ${report.id}

───────────────────────────────────────────────────────────────
                    EXECUTION TRACE
───────────────────────────────────────────────────────────────
`;

  for (const step of report.executionTrace) {
    const time = new Date(step.timestamp).toISOString().split('T')[1].split('.')[0];
    text += `[${time}] ${step.type.toUpperCase()}: ${step.detail}\n`;
    if (step.data) {
      text += `         Data: ${JSON.stringify(step.data)}\n`;
    }
  }

  text += `
───────────────────────────────────────────────────────────────
                    QUERIES EXECUTED
───────────────────────────────────────────────────────────────
`;

  for (let i = 0; i < report.queriesExecuted.length; i++) {
    const q = report.queriesExecuted[i];
    text += `
Query #${i + 1}:
  Table: ${q.table}
  SQL: ${q.queryText}
  Parameters: ${JSON.stringify(q.parameters)}
  Results: ${q.resultCount}
`;
  }

  text += `
───────────────────────────────────────────────────────────────
                    TABLES SEARCHED
───────────────────────────────────────────────────────────────
${report.tablesSearched.join(', ')}

───────────────────────────────────────────────────────────────
                    PASSAGES EXAMINED (${report.passagesExamined.length})
───────────────────────────────────────────────────────────────
`;

  for (const p of report.passagesExamined) {
    text += `
[${p.id}] ${p.accepted ? 'ACCEPTED' : 'REJECTED'}
  Source: ${p.source}
  Work: ${p.workTitle || 'N/A'}
  Similarity: ${p.similarity.toFixed(3)}
  ${p.rejectionReason ? `Rejection: ${p.rejectionReason}` : ''}
  Text: ${p.text.substring(0, 200)}...
`;
  }

  text += `
───────────────────────────────────────────────────────────────
                    DIRECT ANSWERS FOUND (${report.directAnswersFound.length})
───────────────────────────────────────────────────────────────
`;

  for (let i = 0; i < report.directAnswersFound.length; i++) {
    const da = report.directAnswersFound[i];
    text += `
Direct Answer #${i + 1}:
  Source: ${da.source}
  Work: ${da.workTitle || 'N/A'}
  Text: ${da.text.substring(0, 300)}...
`;
  }

  text += `
───────────────────────────────────────────────────────────────
                    ALIGNMENT CHECK
───────────────────────────────────────────────────────────────
Aligned: ${report.alignmentResult.aligned}
Conflicting: ${report.alignmentResult.conflicting}
No Direct Answer: ${report.alignmentResult.noDirectAnswer}
Summary: ${report.alignmentResult.summary}

───────────────────────────────────────────────────────────────
                    LLM USAGE
───────────────────────────────────────────────────────────────
Model: ${report.llmUsage.model}
${report.llmUsage.tokenCount ? `Tokens - Input: ${report.llmUsage.tokenCount.input}, Output: ${report.llmUsage.tokenCount.output}` : ''}

───────────────────────────────────────────────────────────────
                    FINAL ANSWER
───────────────────────────────────────────────────────────────
Faithfulness: ${report.faithfulnessNote}

${report.finalAnswer}

═══════════════════════════════════════════════════════════════
                    END OF REPORT
═══════════════════════════════════════════════════════════════
`;

  return text;
}
