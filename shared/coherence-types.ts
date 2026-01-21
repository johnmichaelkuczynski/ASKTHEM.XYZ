// shared/coherence-types.ts
// Export these types for use across client/server/shared

export type CoherenceMode =
  | 'logical-consistency'
  | 'logical-cohesiveness'
  | 'scientific-explanatory'
  | 'thematic-psychological'
  | 'instructional'
  | 'motivational'
  | 'mathematical'
  | 'philosophical';

export interface BaseCoherenceState {
  mode: CoherenceMode;
  [key: string]: any; // for flexibility
}

export interface LogicalConsistencyState extends BaseCoherenceState {
  mode: 'logical-consistency';
  assertions: string[];               // claims asserted so far
  negations: string[];                // claims explicitly denied
  disjoint_pairs: [string, string][]; // mutually exclusive claim pairs
}

export interface LogicalCohesivenessState extends BaseCoherenceState {
  mode: 'logical-cohesiveness';
  thesis: string;
  support_queue: string[];            // promised supports not yet delivered
  current_stage: 'setup' | 'support' | 'objection' | 'reply' | 'synthesis' | 'conclusion';
  bridge_required: string;            // what must be connected next
}

export interface PhilosophicalState extends BaseCoherenceState {
  mode: 'philosophical';
  core_concepts: Record<string, string>; // concept → brief definition/explanation
  distinctions: Array<{ term1: string; term2: string; difference: string }>;
  dialectic: {
    thesis: string;
    antithesis: string[];
    synthesis: string[];
  };
  unresolved_objections: string[];
}

export interface MathematicalState extends BaseCoherenceState {
  mode: 'mathematical';
  givens: string[];                   // axioms/assumptions
  proved_lemmas: string[];            // completed proofs
  goal: string;                       // theorem to prove
  proof_method: string;               // induction, contradiction, direct, etc.
}

// Union type for convenience
export type CoherenceState =
  | LogicalConsistencyState
  | LogicalCohesivenessState
  | PhilosophicalState
  | MathematicalState
  // | add others as you implement them
  | BaseCoherenceState; // fallback

export interface ChunkEvaluationResult {
  status: 'preserved' | 'weakened' | 'broken';
  violations: Array<{
    location: string;
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'critical';
  }>;
  repairs: Array<{
    location: string;
    suggestion: string;
  }>;
  state_update: Partial<CoherenceState>;
}

export interface CoherenceProgressEvent {
  chunkIndex: number;
  totalChunks: number;
  status: string;
  violationsCount: number;
  message?: string;
}