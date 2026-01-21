export interface AuditStep {
  timestamp: number;
  type: 'query' | 'table_search' | 'passage_examined' | 'passage_accepted' | 'passage_rejected' | 
        'direct_answer_found' | 'alignment_check' | 'search_complete' | 'no_direct_answer' | 'error' |
        'passage_found' | 'direct_answer' | 'llm_call' | 'final_decision';
  detail: string;
  data?: Record<string, unknown>;
}

export interface PassageResult {
  id: string;
  source: string;
  workTitle?: string;
  chunkIndex?: number;
  text: string;
  similarity?: number;
  accepted: boolean;
  rejectionReason?: string;
}

export interface DirectAnswer {
  passageId: string;
  text: string;
  source: string;
  workTitle?: string;
  topic?: string;
  relevanceScore?: number;
  reasoning?: string;
}

export interface AlignmentResult {
  aligned: boolean;
  conflicting: boolean;
  noDirectAnswer?: boolean;
  summary: string;
  conflictDescription?: string;
}

export interface LLMUsage {
  model: string;
  promptBlocks?: {
    system: string;
    user: string;
    retrievedContext: string;
  };
  tokenCount?: {
    input: number;
    output: number;
  };
  temperature?: number;
}

export interface AuditReport {
  id: string;
  timestamp: number;
  question: string;
  authorId: string;
  authorName: string;
  
  executionTrace?: AuditStep[];
  events?: AuditStep[];
  
  queriesExecuted?: {
    queryText: string;
    table: string;
    parameters: Record<string, unknown>;
    resultCount: number;
  }[];
  
  tablesSearched: string[];
  
  passagesExamined?: PassageResult[];
  
  directAnswersFound?: DirectAnswer[];
  directAnswers?: DirectAnswer[];
  
  alignmentResult?: AlignmentResult;
  
  llmUsage?: LLMUsage;
  model?: string;
  
  contextLength?: number;
  answerType?: string;
  
  finalAnswer: string;
  
  faithfulnessNote?: 'direct_answer_based' | 'adjacent_material_based' | 'insufficient_data' | 'direct' | 'indirect';
}

export type AuditSummary = AuditReport;

export interface AuditEvent {
  timestamp: number;
  type: AuditStep['type'] | 'step' | 'passage' | 'direct_answer' | 'alignment' | 'llm' | 'complete';
  detail?: string;
  data?: AuditStep | PassageResult | DirectAnswer | AlignmentResult | LLMUsage | { answer: string } | Record<string, unknown>;
}
