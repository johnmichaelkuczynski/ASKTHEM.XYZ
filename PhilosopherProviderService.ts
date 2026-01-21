// src/services/PhilosopherProviderService.ts

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { quotes, positions, arguments as dbArguments, chunks as dbChunks } from "../../shared/schema";
import { eq, ilike } from "drizzle-orm";
import re2 from "re2";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "default_key",
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "default_key",
});

const DEFAULT_MODEL = "claude-3-5-sonnet-20241022"; // Best for philosophical depth
const MAX_SHORT_TOKENS = 2048;

interface ThinkerMaterial {
  quotes: string[];
  positions: string[];
  arguments: string[];
  chunks: string[];
  deductions: string;
}

class RuleEngine {
  private rules: Array<{ id: number; topic: string; premise: string; conclusion: string }> = [];
  private loaded = false;
  private thinker: string;

  constructor(thinker: string) {
    this.thinker = thinker.toLowerCase().replace(/ /g, "_");
  }

  private loadRules() {
    if (this.loaded) return;
    const rulesPath = path.join(__dirname, "..", "rules", `${this.thinker}_rules_full.json`);
    try {
      const data = fs.readFileSync(rulesPath, "utf8");
      this.rules = JSON.parse(data);
      console.log(`Loaded ${this.rules.length} rules for ${this.thinker}`);
    } catch (err) {
      console.warn(`No rules for ${this.thinker}: ${err}`);
      this.rules = [];
    }
    this.loaded = true;
  }

  deduce(query: string, context: string): string {
    this.loadRules();
    if (!this.rules.length) return "";

    let activated: string[] = [];
    let text = `${query} ${context}`.toLowerCase();

    for (const rule of this.rules) {
      try {
        const regex = new re2(rule.premise, "i");
        if (regex.test(text)) {
          activated.push(rule.conclusion);
          text += ` ${rule.conclusion.toLowerCase()}`;
        }
      } catch {
        continue;
      }
    }

    return activated.length > 0
      ? `Relevant inferences from ${this.thinker}:\n${activated.join("\n\n")}`
      : "";
  }
}

export class PhilosopherProviderService {
  private async fetchGroundingMaterial(thinker: string, query: string): Promise<ThinkerMaterial> {
    const lower = thinker.toLowerCase();

    const [q, pos, arg, ch] = await Promise.all([
      db.select().from(quotes).where(ilike(quotes.thinker, `%${lower}%`)).limit(20),
      db.select().from(positions).where(ilike(positions.thinker, `%${lower}%`)).limit(15),
      db.select().from(dbArguments).where(ilike(dbArguments.thinker, `%${lower}%`)).limit(15),
      db.select().from(dbChunks).where(ilike(dbChunks.thinker, `%${lower}%`)).limit(10),
    ]);

    const engine = new RuleEngine(thinker);
    const contextForDeduce = [
      ...q.map(r => r.quote_text || ""),
      ...pos.map(r => r.position_text || ""),
      ...arg.map(r => r.argument_text || ""),
      ...ch.map(r => r.chunk_text || ""),
    ].join(" ");
    const deductions = engine.deduce(query, contextForDeduce);

    return {
      quotes: q.map(r => r.quote_text || ""),
      positions: pos.map(r => r.position_text || ""),
      arguments: arg.map(r => r.argument_text || ""),
      chunks: ch.map(r => r.chunk_text || ""),
      deductions,
    };
  }

  private buildSystemPrompt(thinker: string, material: ThinkerMaterial): string {
    const { quotes, positions, arguments, chunks, deductions } = material;

    return `
You are ${thinker}, responding in your authentic voice, style, terminology, and philosophical depth.
You may ONLY use the material provided below. Do NOT invent views, quotes, positions, or facts absent from it.

GROUNDING SOURCES:
QUOTES:
${quotes.slice(0, 12).join("\n\n")}

POSITIONS:
${positions.slice(0, 10).join("\n\n")}

ARGUMENTS:
${arguments.slice(0, 8).join("\n\n")}

EXTENDED CHUNKS:
${chunks.slice(0, 6).join("\n\n")}

${deductions ? `\nINFERENCES & DEDUCTIONS:\n${deductions}\n` : ""}

STRICT RULES:
1. Ground every claim in the provided material — extrapolate intelligently but never fabricate.
2. If query has no direct match, connect logically to the closest related ideas.
3. Synthesize and elaborate into high-quality, natural, intelligent prose.
4. Speak in first person as ${thinker}.
5. Be concise unless length is explicitly requested.
6. Maintain historical/philosophical consistency — no anachronisms.
`;
  }

  async generateResponse(
    thinker: string,
    userQuery: string,
    targetWords?: number
  ): Promise<string> {
    try {
      const material = await this.fetchGroundingMaterial(thinker, userQuery);
      const systemPrompt = this.buildSystemPrompt(thinker, material);

      // Decide if we should warn about long request (coherence service handles actual long)
      const estimatedLength = (targetWords || 0) > 800 || userQuery.toLowerCase().includes("long") || userQuery.toLowerCase().includes("essay")
        ? "This may require extended generation. For very long outputs, use the coherence pipeline."
        : "";

      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: MAX_SHORT_TOKENS,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: "user", content: userQuery }],
      });

      let text = response.content[0].text || "No response generated.";

      if (estimatedLength) {
        text = `${estimatedLength}\n\n${text}`;
      }

      return text;
    } catch (err) {
      console.error("Generation error:", err);
      return "Error generating response. Please try again later.";
    }
  }
}

export const philosopherProviderService = new PhilosopherProviderService();
