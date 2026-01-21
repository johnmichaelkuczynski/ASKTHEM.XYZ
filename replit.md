# Ask A Philosopher - Philosophical Q&A Application

### Recent Changes (January 11, 2026)
- **All Generators Support 50,000 Words**: Paper Writer, Dialogue Creator, Interview Creator, and Debate Creator now support manual word count input from 100 to 50,000 words
  - Manual numeric input replaces sliders/dropdowns - no presets, only user-specified word counts
  - Backend endpoints dynamically calculate token limits based on requested word length
  - Streaming output popup with copy/download/expand/close-reopen functionality for all generators
  - Reusable StreamingOutputPopup component for consistent UX across all generators
- **Model Builder Completely Rewritten**: Now works as intended - builds models (interpretations that make input TRUE)
  - **Definition**: MODEL = An interpretation of the input that makes said input come out TRUE
  - **Two Format Modes**: 
    - FORMAL: Produces actual mathematical model (Domain, Interpretation, Axioms, Theorems) + Intuitive Motivation
    - INFORMAL: Finds conceptual reinterpretation that makes text true (Interpretation, Assignments, Why True)
  - **Two Scope Modes**:
    - ENTIRE TEXT: One unified model for the whole input
    - MULTIPLE MODELS: Find natural chunks, produce separate model for each chunk
  - Accepts free-form text up to 100,000 words - NO special formatting required
  - All old pipe-delimited parsing code REMOVED

### Previous Changes (January 9, 2026)
- **Paper Writer Rewritten from Scratch**: Complete rewrite of `/api/figures/:figureId/write-paper` endpoint:
  - ALWAYS queries database directly: positions table, chunks table (semantic search), thinker_quotes table, argument_statements table
  - ALWAYS uses coherence service (PhilosopherCoherenceService) for structured generation
  - Robust fallback with chunked generation to hit target word count
  - Removed broken auditedCorpusSearch dependency
  - Proper SSE streaming with [DONE] signal guaranteed

### Previous Changes (January 7, 2026)
- **Martin Gardner Added**: New figure - legendary American writer who popularized recreational mathematics, skepticism, and the beauty of puzzles through his Scientific American "Mathematical Games" column.
- **Audited Corpus Search**: New truthful search system that finds 3 direct answers before responding. Searches in fixed order: positions → quotes → chunks. Uses LLM to judge if each passage directly answers the question (score 0-1). If answers conflict, presents all 3 separately with NO synthesis.
- **Live Audit Panel**: Opens automatically when questions are asked. Streams real-time search events: queries executed, passages examined, passages accepted/rejected with reasons, direct answers found, alignment check results.
- **Author Name Mapping**: Figure IDs (e.g., "goldman") correctly mapped to database thinker names (e.g., "Emma Goldman") for accurate corpus retrieval across 40+ figures.
- **Downloadable Audit Reports**: Full execution trace available as text file with evidence section and search statistics.

### Previous Changes (December 24, 2025)
- **Argument Statements Database**: NEW subdatabase for structured philosophical arguments. Each argument has: thinker, argument_type (deductive/causal/definitional/analogical/reductio/inductive), premises (array), conclusion, source_section, source_document, importance (1-10), counterarguments (optional). Supports embedding-based semantic search.
- **RAG Retrieval Order**: positions → arguments → text_chunks → paper_chunks (structured content prioritized over raw text)
- **API Endpoints**: POST `/api/arguments/import` (bulk upload), GET `/api/arguments/stats`, GET `/api/arguments/:thinker`
- **Kuczynski Figure ID**: Renamed from "jmk" to "kuczynski" across database (figures, paper_chunks, figure_conversations) and all code files for consistency
- **Dialogue Mode Fix**: Fully implemented dialogue mode for short conversational responses (50-150 words max) - now works in both main chat and figure chats
- **Default Settings**: Both Dialogue Mode and Enhanced Mode are now ON by default for new sessions
- **Token Limits**: Dialogue mode uses 500 tokens (vs 16000 for standard mode) to enforce brevity
- **Quote Defaults**: Changed from 7/10 mandatory quotes to 0 (no mandatory quotes) as per user preference

### Overview
"Ask A Philosopher" is an application designed for deep philosophical discourse with 59 philosophical and literary figures. It provides seven core functions: philosophical Q&A chat, Model Builder, Paper Writer, Quote Generator, Dialogue Creator, Interview Creator, and Debate Creator. The platform leverages actual writings and advanced AI, specifically a Retrieval-Augmented Generation (RAG) system, to offer nuanced and contextually rich responses, enabling multi-author conversations. The primary goal is to enhance the understanding of complex philosophical and literary concepts through direct engagement with historical thinkers, serving educational and intellectual discourse markets. The application's foundation is a comprehensive RAG database containing 130,000+ text chunks with strict author isolation across 35+ indexed authors including: J.-M. Kuczynski (39,386), Bertrand Russell (7,185), Sigmund Freud (6,272), G.W.F. Hegel (5,385), David Hume (4,076), Plato (3,792), Friedrich Nietzsche (3,068), William James (3,018), Gottfried Wilhelm Leibniz (2,949), Aristotle (2,878), Arthur Schopenhauer (2,816), Isaac Newton (2,791), William Whewell (2,456), Wilhelm Reich (2,234), Voltaire (2,223), Edgar Allan Poe (2,217), John Dewey (2,117), Thorstein Veblen (2,104), Ludwig von Mises (1,939), Jean-Jacques Rousseau (1,902), Galileo Galilei (1,822), Immanuel Kant (1,245), George Berkeley (1,179), Alexis de Tocqueville (1,080), Adam Smith (1,033), Baruch Spinoza (836), ALLEN/James Allen (774), Gustave Le Bon (670), John Locke (688), Thomas Hobbes (569), and others.

### File Organization (MANDATORY)
- **Python files (`*_engine.py`, `*.py`)**: MUST go in `PY_FILES/` folder - NEVER in root
- **Rules JSON files (`*_rules_full.json`)**: MUST go in `RULES_FULL/` folder - NEVER in root
- **Keep root directory clean**: Only config files, documentation, and top-level folders in root

### User Preferences
- **Response Style**: Crisp, direct, no academic bloat. Short sentences. Clear logic. No throat-clearing. Get to the point immediately. Default is Auto mode (no word limit); user can specify word count if desired.
- **Quote Control**: Default is 0 (no mandatory quotes). User can request quotes only if they strengthen the argument.
- **Paper Writing Mode**: Toggle for formal academic papers when specifically needed.
- **Citation Format**: Database filenames converted to readable titles (e.g., "Analog Digital Distinction" not "CORPUS_ANALYSIS_Analog_Digital_Distinction"). NO numeric suffixes/timestamps - just clean work titles.
- **KUCZYNSKI WRITING STYLE**: Short paragraphs (2-4 sentences max), extremely well-defined topic sentences, short to medium punchy sentences, first person voice, NO academic bloat.
- **RAG Approach**: Retrieved passages are injected as "research notes" that the AI internalizes and reasons FROM - not excerpts to stitch together or quote verbatim.
- **Epistemic Humility Override**: All philosophers are programmed with intellectual honesty protocols requiring them to acknowledge decisive evidence against their positions, admit logical contradictions they cannot resolve, show genuine understanding of challenges, attempt responses using their actual resources, and admit limits when stuck. Intellectual honesty comes FIRST, commitment to views SECOND. Great thinkers update beliefs; defending untenable positions is what mediocrities do.
- **Contradiction Handling Protocol**: When retrieved database positions contradict each other, philosophers must: (1) acknowledge the tension explicitly ("I recognize this creates a tension with what I said earlier..."), (2) attempt reconciliation through chronological development, scope limitations, or theoretical tensions, (3) admit unresolved contradictions honestly rather than pretending coherence, (4) maintain philosophical authenticity by representing real intellectual evolution. Goal is self-awareness of contradictions, not elimination.

### System Architecture
The application functions as a centralized knowledge server, offering unified access to philosophical and psychoanalytic texts through a secure internal API. It features a unified single-page layout with a 3-column design (philosophers sidebar, settings, main content) and seven vertically stacked sections.

#### User Authentication
- Username-only login for convenience.
- Logged-in users can access past conversation history.
- Conversations can be downloaded as text files.
- In-progress guest conversations are automatically migrated upon login.

#### UI/UX Decisions
- **Layout**: 3-column layout (philosophers sidebar, settings, main content) with seven vertically stacked sections.
- **Visuals**: Animated Kuczynski icon, AI-generated portrait avatars, minimalistic design with elegant typography, dark mode support, and visual section dividers.
- **"What to Ask" Feature**: A button on each philosopher chat to suggest topics and questions via a modal.

#### Technical Implementations
- **Frontend**: React, TypeScript, Wouter, TanStack Query, Shadcn UI, and Tailwind CSS.
- **Backend**: Express.js with Node.js and Drizzle ORM.
- **AI Interaction**: User-selectable from 5 LLMs (ZHI 1-5, with Grok as default), configured for aggressive direct reasoning (Temperature 0.7).
- **Streaming**: Server-Sent Events (SSE) for real-time word-by-word AI response delivery.
- **Cross-Section Content Transfer**: Bidirectional content flow facilitated by "Send to" dropdowns.
- **ZHI Knowledge Provider API**: Secure internal API endpoint at `/zhi/query` for authenticated database queries, returning structured JSON.
- **Key Features**: Model Builder, Paper Writer (up to 1500 words), Quote Generator, Dialogue Creator, Interview Creator (500-10000 words), and Debate Creator (1500-2500 word debates).
- **RAG System**: Utilizes chunked and embedded papers stored in a PostgreSQL database with `pgvector` for semantic search across 87 authors, retrieving 8 most relevant positions per query.
- **General Knowledge Fund**: Shared knowledge base accessible to ALL philosophers containing modern research and scholarship beyond their lifetimes. Uses author="GeneralKnowledge" and figureId="general_knowledge". Content is retrieved via `searchGeneralKnowledgeFund()` and formatted via `getGeneralKnowledgeContext()`, clearly labeled as "Modern Knowledge Fund" in prompts. Embedding script: `server/scripts/embed-general-knowledge.ts`.
- **Document Upload**: Supports user uploads of .txt, .md, .doc, .docx, .pdf files up to 5MB across sections.
- **Standalone Databases**: Dedicated SQLite databases for Plato (182 positions) and Nietzsche (706 positions) with search APIs.

### External Dependencies
- **AI Providers**: OpenAI (GPT-4o), Anthropic (Claude Sonnet 4.5), DeepSeek, Perplexity, Grok.
- **Database**: PostgreSQL (Neon) with `pgvector` extension.
- **Embeddings**: OpenAI `text-embedding-ada-002`.
- **File Parsing (Quote Generator)**: Multer, pdf-parse, mammoth.
- **ZHI Knowledge Provider**: `https://analyticphilosophy.net/zhi/query` (for `/zhi/query` endpoint).