import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, Loader2, ArrowRight, Copy, Trash2, Maximize2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import type { Figure } from "@shared/schema";
import { usePopupManager } from "@/contexts/popup-manager-context";
import { DragDropUpload } from "@/components/ui/drag-drop-upload";

function getDisplayName(fullName: string): string {
  const keepFullName = ["James Allen", "William James", "ALLEN"];
  if (keepFullName.includes(fullName)) {
    return fullName;
  }
  const parts = fullName.split(' ');
  return parts[parts.length - 1];
}

interface PaperWriterSectionProps {
  onRegisterInput?: (setter: (topic: string) => void) => void;
  onTransferContent?: (content: string, target: 'chat' | 'model' | 'paper') => void;
}

export function PaperWriterSection({ onRegisterInput, onTransferContent }: PaperWriterSectionProps) {
  const [topic, setTopic] = useState("");
  const [selectedPhilosopher, setSelectedPhilosopher] = useState("");
  const [wordLength, setWordLength] = useState("1500");
  const [numberOfQuotes, setNumberOfQuotes] = useState("0");
  const [customInstructions, setCustomInstructions] = useState("");
  const [generatedPaper, setGeneratedPaper] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [paperText, setPaperText] = useState<string>('');
  const [coherenceResult, setCoherenceResult] = useState<any>(null);
  const [showRewritePanel, setShowRewritePanel] = useState(false);
  const [rewriteInstructions, setRewriteInstructions] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const { registerPopup, updatePopup } = usePopupManager();

  const handleFileAccepted = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-file", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to parse file");
      }

      const data = await response.json();
      setTopic(data.text);
      setUploadedFileName(file.name);
      toast({
        title: "File uploaded",
        description: `${file.name} has been loaded`,
      });
    } catch (error) {
      console.error("Error parsing file:", error);
      toast({
        title: "Upload failed",
        description: "Failed to parse the file. Try a different format.",
        variant: "destructive",
      });
    }
  };

  const handleClearFile = () => {
    setUploadedFileName("");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedPaper);
    toast({
      title: "Copied to clipboard",
      description: "Paper has been copied.",
    });
  };

  const handleDelete = () => {
    setGeneratedPaper("");
    toast({
      title: "Output cleared",
      description: "The generated paper has been cleared.",
    });
  };

  useEffect(() => {
    if (onRegisterInput) {
      onRegisterInput((topic: string) => {
        setTopic(topic);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      });
    }
  }, [onRegisterInput]);

  const { data: figures = [] } = useQuery<Figure[]>({
    queryKey: ["/api/figures"],
  });

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !selectedPhilosopher) {
      return;
    }

    const parsedWordLength = parseInt(wordLength) || 1500;
    if (parsedWordLength < 100 || parsedWordLength > 50000) {
      toast({
        title: "Invalid word length",
        description: "Please enter a number between 100 and 50,000",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setPaperText('');
    setCoherenceResult(null);
    setGeneratedPaper("");
    
    const philosopher = figures.find(f => f.id === selectedPhilosopher);
    const popupId = `paper-writer-${Date.now()}`;
    registerPopup({
      id: popupId,
      title: `Paper: ${philosopher?.name || "Philosopher"} - ${topic.slice(0, 30)}...`,
      content: "",
      isGenerating: true,
      filename: `${philosopher?.name.replace(/\s+/g, '_')}_${topic.slice(0, 30).replace(/\s+/g, '_')}.txt`,
      onStop: () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      },
    });
    
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/figures/${selectedPhilosopher}/write-paper`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topic.trim(),
          wordLength: parsedWordLength,
          numberOfQuotes: parseInt(numberOfQuotes) || 0,
          customInstructions: customInstructions.trim(),
          hasDocument: !!uploadedFileName,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to generate paper");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let accumulatedText = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                setIsGenerating(false);
                updatePopup(popupId, { isGenerating: false });
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulatedText += parsed.content;
                  setGeneratedPaper(accumulatedText);
                  updatePopup(popupId, { content: accumulatedText });
                }
              } catch (e) {
                console.error("Parse error:", e);
              }
            }
          }
        }
      }
      setIsGenerating(false);
      updatePopup(popupId, { isGenerating: false });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        toast({
          title: "Generation stopped",
          description: "Paper generation was stopped.",
        });
        updatePopup(popupId, { isGenerating: false });
      } else {
        console.error("Error generating paper:", error);
        toast({
          title: "Generation failed",
          description: "Failed to generate paper. Please try again.",
          variant: "destructive",
        });
        updatePopup(popupId, { isGenerating: false });
      }
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    const philosopher = figures.find(f => f.id === selectedPhilosopher);
    const filename = `${philosopher?.name.replace(/\s+/g, '_')}_${topic.slice(0, 30).replace(/\s+/g, '_')}.txt`;
    const blob = new Blob([generatedPaper], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRewrite = async () => {
    if (!generatedPaper || !selectedPhilosopher || !rewriteInstructions.trim()) {
      toast({
        title: "Missing information",
        description: "Please provide rewrite instructions",
        variant: "destructive",
      });
      return;
    }

    const parsedWordLength = parseInt(wordLength) || 1500;
    setIsGenerating(true);
    
    const philosopher = figures.find(f => f.id === selectedPhilosopher);
    const rewritePopupId = `paper-rewrite-${Date.now()}`;
    registerPopup({
      id: rewritePopupId,
      title: `Rewrite: ${philosopher?.name || "Philosopher"} - ${topic.slice(0, 30)}...`,
      content: "",
      isGenerating: true,
      filename: `${philosopher?.name.replace(/\s+/g, '_')}_rewrite_${topic.slice(0, 30).replace(/\s+/g, '_')}.txt`,
      onStop: () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      },
    });
    
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/figures/${selectedPhilosopher}/rewrite-paper`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originalPaper: generatedPaper,
          topic: topic.trim(),
          rewriteInstructions: rewriteInstructions.trim(),
          wordLength: parsedWordLength,
          numberOfQuotes: parseInt(numberOfQuotes) || 0,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to rewrite paper");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let accumulatedText = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                setIsGenerating(false);
                updatePopup(rewritePopupId, { isGenerating: false });
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulatedText += parsed.content;
                  setGeneratedPaper(accumulatedText);
                  updatePopup(rewritePopupId, { content: accumulatedText });
                }
              } catch (e) {
                console.error("Parse error:", e);
              }
            }
          }
        }
      }
      setIsGenerating(false);
      updatePopup(rewritePopupId, { isGenerating: false });
      setRewriteInstructions("");
      setShowRewritePanel(false);
      toast({
        title: "Rewrite complete",
        description: "Paper has been rewritten with your instructions.",
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        toast({
          title: "Rewrite stopped",
          description: "Paper rewrite was stopped.",
        });
      } else {
        console.error("Error rewriting paper:", error);
        toast({
          title: "Rewrite failed",
          description: "Failed to rewrite paper. Please try again.",
          variant: "destructive",
        });
      }
      setIsGenerating(false);
      updatePopup(rewritePopupId, { isGenerating: false });
    }
  };

  const wordCount = generatedPaper.split(/\s+/).filter(w => w.length > 0).length;
  const philosopher = figures.find(f => f.id === selectedPhilosopher);

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <CardTitle>Paper Writer</CardTitle>
          </div>
          <CardDescription>
            Generate formal philosophical papers in authentic voice (up to 50,000 words)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="philosopher-select-paper">Select Philosopher</Label>
                <Select
                  value={selectedPhilosopher}
                  onValueChange={setSelectedPhilosopher}
                >
                  <SelectTrigger id="philosopher-select-paper" data-testid="select-philosopher-paper">
                    <SelectValue placeholder="Choose a philosopher..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {figures.map((figure) => (
                      <SelectItem key={figure.id} value={figure.id}>
                        {getDisplayName(figure.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Upload Document (Optional)</Label>
                <DragDropUpload
                  onFileAccepted={handleFileAccepted}
                  onClear={handleClearFile}
                  currentFileName={uploadedFileName}
                  accept=".txt,.md,.doc,.docx,.pdf"
                  maxSizeBytes={5 * 1024 * 1024}
                  data-testid="drag-drop-upload-paper"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic-input-paper">Paper Topic or Question</Label>
                <Textarea
                  ref={textareaRef}
                  id="topic-input-paper"
                  placeholder="e.g., 'The nature of consciousness' or upload a document above..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (topic.trim() && selectedPhilosopher && !isGenerating) {
                        handleGenerate();
                      }
                    }
                  }}
                  rows={6}
                  data-testid="input-topic-paper"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="word-length-input">Word Length (100 - 50,000)</Label>
                  <Input
                    id="word-length-input"
                    type="number"
                    min={100}
                    max={50000}
                    value={wordLength}
                    onChange={(e) => setWordLength(e.target.value)}
                    placeholder="Word count..."
                    data-testid="input-word-length"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quotes-input">Number of Quotes (0-50)</Label>
                  <Input
                    id="quotes-input"
                    type="number"
                    min={0}
                    max={50}
                    value={numberOfQuotes}
                    onChange={(e) => setNumberOfQuotes(e.target.value)}
                    placeholder="0"
                    data-testid="input-quotes"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-instructions">Custom Instructions (optional)</Label>
                <Textarea
                  id="custom-instructions"
                  placeholder="e.g., 'Focus on epistemology', 'Include critique of empiricism', 'Use formal logic notation'..."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={2}
                  data-testid="input-custom-instructions"
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim() || !selectedPhilosopher}
                className="w-full"
                data-testid="button-generate-paper"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating with Coherence...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Coherent Paper
                  </>
                )}
              </Button>

              {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating paper with coherence constraints...</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Label>Generated Paper</Label>
                  {generatedPaper && !isGenerating && (
                    <span className="text-xs text-muted-foreground" data-testid="text-paper-word-count">
                      {wordCount.toLocaleString()} words
                    </span>
                  )}
                </div>
                {generatedPaper && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                      className="h-7 px-2"
                      data-testid="button-copy-paper"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      data-testid="button-delete-paper"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                    {onTransferContent && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 gap-1"
                            data-testid="button-transfer-paper"
                          >
                            Send to
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => onTransferContent(generatedPaper, 'chat')}
                            data-testid="menu-transfer-to-chat"
                          >
                            Chat Input
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => onTransferContent(generatedPaper, 'model')}
                            data-testid="menu-transfer-to-model"
                          >
                            Model Builder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                      className="h-7 px-2"
                      data-testid="button-download-paper"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowRewritePanel(!showRewritePanel)}
                      className="h-7 px-2"
                      data-testid="button-rewrite-paper"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Rewrite
                    </Button>
                  </div>
                )}
              </div>
              
              {showRewritePanel && generatedPaper && !isGenerating && (
                <div className="border rounded-lg p-4 bg-muted/50 space-y-3">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Rewrite Paper</Label>
                  </div>
                  <Textarea
                    placeholder="Enter your criticisms, corrections, or instructions for the rewrite... e.g., 'Too wordy - tighten the prose', 'Add more examples', 'Focus more on X, less on Y', 'Include quotes from specific works'..."
                    value={rewriteInstructions}
                    onChange={(e) => setRewriteInstructions(e.target.value)}
                    rows={3}
                    data-testid="input-rewrite-instructions"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleRewrite}
                      disabled={!rewriteInstructions.trim()}
                      className="flex-1"
                      data-testid="button-submit-rewrite"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Rewrite with Instructions
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowRewritePanel(false);
                        setRewriteInstructions("");
                      }}
                      data-testid="button-cancel-rewrite"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              
              <div className="border rounded-lg p-4 min-h-[300px] max-h-[500px] overflow-y-auto bg-muted/30">
                {!generatedPaper && !isGenerating ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-center">
                    <div className="space-y-2">
                      <FileText className="w-12 h-12 mx-auto opacity-20" />
                      <p>Select a philosopher and topic to generate a paper</p>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{generatedPaper}</ReactMarkdown>
                    {isGenerating && (
                      <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
