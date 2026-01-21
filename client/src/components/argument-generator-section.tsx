import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, GitBranch, Copy, Trash2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Figure } from "@shared/schema";

function getDisplayName(fullName: string): string {
  const keepFullName = ["James Allen", "William James", "ALLEN"];
  if (keepFullName.includes(fullName)) {
    return fullName;
  }
  const parts = fullName.split(' ');
  return parts[parts.length - 1];
}

interface ArgumentGeneratorSectionProps {
  onRegisterInput?: (setter: (content: string) => void) => void;
}

export function ArgumentGeneratorSection({ onRegisterInput }: ArgumentGeneratorSectionProps) {
  const [selectedThinker, setSelectedThinker] = useState('');
  const [keywords, setKeywords] = useState('');
  const [numArguments, setNumArguments] = useState('10');
  const [generatedArguments, setGeneratedArguments] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  const keywordsInputRef = useRef<HTMLTextAreaElement>(null);

  const { data: figures = [] } = useQuery<Figure[]>({
    queryKey: ["/api/figures"],
  });

  useEffect(() => {
    if (onRegisterInput) {
      onRegisterInput((content: string) => setKeywords(content));
    }
  }, [onRegisterInput]);

  const handleGenerate = async () => {
    if (!selectedThinker) {
      toast({
        title: "Missing thinker",
        description: "Please select a thinker.",
        variant: "destructive",
      });
      return;
    }

    const argumentsNum = parseInt(numArguments) || 10;
    if (argumentsNum < 1 || argumentsNum > 100) {
      toast({
        title: "Invalid number",
        description: "Number of arguments must be between 1 and 100.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setGeneratedArguments('');

    try {
      const response = await fetch('/api/arguments/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          thinker: selectedThinker,
          keywords: keywords.trim(),
          numArguments: argumentsNum,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                setGeneratedArguments(fullText);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      if (fullText) {
        toast({
          title: "Arguments generated",
          description: `Generated ${argumentsNum} arguments for ${selectedThinker}`,
        });
      }

    } catch (error) {
      console.error('Argument generation error:', error);
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Failed to generate arguments",
        variant: "destructive",
      });
      setGeneratedArguments('');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedArguments);
      toast({
        title: "Copied",
        description: "Arguments copied to clipboard",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    if (!generatedArguments) return;
    
    const blob = new Blob([generatedArguments], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const keywordSlug = keywords.trim() ? `_${keywords.trim().replace(/\s+/g, '_').slice(0, 30)}` : '';
    a.download = `${selectedThinker.replace(/\s+/g, '_')}_arguments${keywordSlug}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Downloaded",
      description: "Arguments saved to file",
    });
  };

  const handleClear = () => {
    setGeneratedArguments('');
    setKeywords('');
  };

  return (
    <Card className="bg-gradient-to-br from-emerald-50/80 via-teal-50/60 to-cyan-50/40 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 border-emerald-200/50 dark:border-slate-600">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
          <GitBranch className="w-5 h-5" />
          Argument Generator
        </CardTitle>
        <CardDescription>
          Generate structured arguments (premises → conclusion) for any thinker
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="argument-thinker">Select Thinker</Label>
            <Select value={selectedThinker} onValueChange={setSelectedThinker}>
              <SelectTrigger id="argument-thinker" data-testid="select-argument-thinker">
                <SelectValue placeholder="Choose a thinker..." />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {figures.map((figure) => (
                  <SelectItem key={figure.id} value={figure.name}>
                    {getDisplayName(figure.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="argument-keywords">Keywords/Instructions (optional)</Label>
            <Textarea
              id="argument-keywords"
              ref={keywordsInputRef}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Optional: ethics, causation, free will, deductive only..."
              rows={2}
              data-testid="input-argument-keywords"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="num-arguments">Number of Arguments (1-100)</Label>
            <Input
              id="num-arguments"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={numArguments}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                if (val === '' || (parseInt(val) >= 1 && parseInt(val) <= 100)) {
                  setNumArguments(val);
                }
              }}
              onBlur={(e) => {
                const val = parseInt(e.target.value);
                if (isNaN(val) || val < 1) setNumArguments('1');
                else if (val > 100) setNumArguments('100');
              }}
              data-testid="input-num-arguments"
            />
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !selectedThinker}
          className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          data-testid="button-generate-arguments"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Arguments...
            </>
          ) : (
            <>
              <GitBranch className="w-4 h-4 mr-2" />
              Generate Arguments
            </>
          )}
        </Button>

        {generatedArguments && (
          <div className="space-y-3">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Label>Generated Arguments</Label>
                <span className="text-xs text-muted-foreground" data-testid="text-arguments-word-count">
                  {generatedArguments.split(/\s+/).filter(w => w.length > 0).length.toLocaleString()} words
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  data-testid="button-copy-arguments"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  data-testid="button-download-arguments"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  data-testid="button-clear-arguments"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>
            <div 
              className="min-h-[400px] max-h-[600px] overflow-y-auto p-4 font-mono text-sm bg-white/80 dark:bg-slate-900/80 border rounded-md whitespace-pre-wrap"
              data-testid="textarea-generated-arguments"
            >
              {generatedArguments}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
