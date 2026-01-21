import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FileText, Upload, RefreshCw, Loader2, CheckCircle, AlertCircle, ClipboardList, Layers, Copy, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GlobalSkeleton {
  outline: string[];
  thesis: string;
  keyTerms: Record<string, string>;
  commitmentLedger: { asserts: string[]; rejects: string[]; assumes: string[] };
  entities: string[];
  audienceParameters: string;
  rigorLevel: string;
}

interface StrictOutlineResult {
  success: boolean;
  skeleton: GlobalSkeleton;
  stats: {
    inputWords: number;
    outlineItems: number;
    keyTerms: number;
    entities: number;
  };
}

export function DocumentGeneratorTools() {
  const { toast } = useToast();
  const [outlineDocument, setOutlineDocument] = useState("");
  const [outlineInstructions, setOutlineInstructions] = useState("");
  const [outlineModel, setOutlineModel] = useState("gpt-4o");
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineResult, setOutlineResult] = useState<StrictOutlineResult | null>(null);
  const [outlineError, setOutlineError] = useState("");

  const [fullDocDocument, setFullDocDocument] = useState("");
  const [fullDocInstructions, setFullDocInstructions] = useState("");
  const [fullDocModel, setFullDocModel] = useState("gpt-4o");
  const [fullDocTargetWords, setFullDocTargetWords] = useState("5000");
  const [fullDocLoading, setFullDocLoading] = useState(false);
  const [fullDocOutput, setFullDocOutput] = useState("");
  const [fullDocStatus, setFullDocStatus] = useState("");
  const [fullDocPhase, setFullDocPhase] = useState("");
  const [fullDocProgress, setFullDocProgress] = useState({ current: 0, total: 0 });
  const [fullDocError, setFullDocError] = useState("");

  const outlineFileRef = useRef<HTMLInputElement>(null);
  const fullDocFileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    setDocument: (text: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setDocument(text);
    };
    reader.readAsText(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((
    e: React.DragEvent,
    setDocument: (text: string) => void
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setDocument(text);
      };
      reader.readAsText(file);
    }
  }, []);

  const copyToClipboard = useCallback((text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${type} copied to clipboard` });
  }, [toast]);

  const downloadAsFile = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: `Downloaded ${filename}` });
  }, [toast]);

  const formatOutlineForExport = useCallback((result: StrictOutlineResult): string => {
    let text = `SEMANTIC SKELETON EXTRACTION\n`;
    text += `${'='.repeat(50)}\n\n`;
    text += `Input: ${result.stats.inputWords} words\n`;
    text += `Outline Items: ${result.stats.outlineItems}\n`;
    text += `Key Terms: ${result.stats.keyTerms}\n\n`;
    text += `THESIS:\n${result.skeleton.thesis}\n\n`;
    text += `OUTLINE:\n`;
    result.skeleton.outline.forEach((item, i) => {
      text += `${i + 1}. ${item}\n`;
    });
    text += `\nKEY TERMS:\n`;
    Object.entries(result.skeleton.keyTerms).forEach(([term, def]) => {
      text += `- ${term}: ${def}\n`;
    });
    text += `\nCOMMITMENT LEDGER:\n`;
    text += `Asserts: ${result.skeleton.commitmentLedger.asserts.join('; ') || 'None'}\n`;
    text += `Rejects: ${result.skeleton.commitmentLedger.rejects.join('; ') || 'None'}\n`;
    text += `Assumes: ${result.skeleton.commitmentLedger.assumes.join('; ') || 'None'}\n`;
    return text;
  }, []);

  const generateStrictOutline = async () => {
    if (!outlineDocument.trim()) return;
    
    setOutlineLoading(true);
    setOutlineError("");
    setOutlineResult(null);
    
    try {
      const response = await fetch("/api/generate-strict-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText: outlineDocument,
          customInstructions: outlineInstructions,
          model: outlineModel
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate outline");
      }
      
      setOutlineResult(data);
    } catch (err) {
      setOutlineError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setOutlineLoading(false);
    }
  };

  const generateFullDocument = async () => {
    if (!fullDocDocument.trim()) return;
    
    setFullDocLoading(true);
    setFullDocError("");
    setFullDocOutput("");
    setFullDocStatus("");
    setFullDocPhase("");
    setFullDocProgress({ current: 0, total: 0 });
    
    try {
      const response = await fetch("/api/reconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: fullDocDocument,
          customInstructions: fullDocInstructions,
          targetWords: parseInt(fullDocTargetWords),
          documentTitle: "Full Document Generation"
        })
      });
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split("\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.error) {
                setFullDocError(parsed.error);
              }
              if (parsed.status) {
                setFullDocStatus(parsed.status);
              }
              if (parsed.phase) {
                setFullDocPhase(parsed.phase);
              }
              if (parsed.chunkIndex !== undefined && parsed.totalChunks !== undefined) {
                setFullDocProgress({ current: parsed.chunkIndex, total: parsed.totalChunks });
              }
              if (parsed.content) {
                setFullDocOutput(prev => prev + parsed.content + "\n\n");
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      setFullDocError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setFullDocLoading(false);
    }
  };

  const clearOutline = () => {
    setOutlineDocument("");
    setOutlineInstructions("");
    setOutlineResult(null);
    setOutlineError("");
  };

  const clearFullDoc = () => {
    setFullDocDocument("");
    setFullDocInstructions("");
    setFullDocOutput("");
    setFullDocStatus("");
    setFullDocPhase("");
    setFullDocProgress({ current: 0, total: 0 });
    setFullDocError("");
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-lg">Test Strict Outline Generator</CardTitle>
              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                Debug Tool
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={outlineModel} onValueChange={setOutlineModel}>
                <SelectTrigger className="w-28 h-8" data-testid="select-outline-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearOutline}
                data-testid="button-clear-outline"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-amber-700">
                Source Document (drag & drop text file here)
              </label>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => outlineFileRef.current?.click()}
                className="text-amber-600 h-auto p-0"
                data-testid="button-upload-outline"
              >
                <Upload className="h-3 w-3 mr-1" />
                Upload document
              </Button>
              <input
                ref={outlineFileRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={(e) => handleFileUpload(e, setOutlineDocument)}
              />
            </div>
            <Textarea
              value={outlineDocument}
              onChange={(e) => setOutlineDocument(e.target.value)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, setOutlineDocument)}
              placeholder="Paste, type, or drag & drop a text file here..."
              className="min-h-[120px] resize-y"
              data-testid="textarea-outline-document"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-amber-700 block mb-1">
              Optional Instructions (leave empty for auto-summary with analysis)
            </label>
            <Textarea
              value={outlineInstructions}
              onChange={(e) => setOutlineInstructions(e.target.value)}
              placeholder="Optional: e.g., 'Create a strict outline' - leave empty for automatic summary with analysis"
              className="min-h-[60px] resize-y"
              data-testid="textarea-outline-instructions"
            />
          </div>
          
          <Button
            onClick={generateStrictOutline}
            disabled={outlineLoading || !outlineDocument.trim()}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            data-testid="button-generate-outline"
          >
            {outlineLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting Skeleton...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Strict Outline
              </>
            )}
          </Button>
          
          {outlineError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{outlineError}</span>
              </div>
            </div>
          )}
          
          {outlineResult && (
            <div className="space-y-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 flex-wrap">
                <CheckCircle className="h-4 w-4" />
                <span className="font-medium">Skeleton Extracted</span>
                <div className="flex gap-2 ml-auto flex-wrap">
                  <Badge variant="secondary">{outlineResult.stats.inputWords} words</Badge>
                  <Badge variant="secondary">{outlineResult.stats.outlineItems} sections</Badge>
                  <Badge variant="secondary">{outlineResult.stats.keyTerms} terms</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(formatOutlineForExport(outlineResult), 'Outline')}
                    data-testid="button-copy-outline"
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadAsFile(formatOutlineForExport(outlineResult), 'semantic-skeleton.txt')}
                    data-testid="button-download-outline"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-1">Thesis:</h4>
                <p className="text-sm text-muted-foreground">{outlineResult.skeleton.thesis}</p>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-1">Outline ({outlineResult.skeleton.outline.length} items):</h4>
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                  {outlineResult.skeleton.outline.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              </div>
              
              {Object.keys(outlineResult.skeleton.keyTerms).length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-1">Key Terms:</h4>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {Object.entries(outlineResult.skeleton.keyTerms).map(([term, def]) => (
                      <div key={term}><strong>{term}:</strong> {def}</div>
                    ))}
                  </div>
                </div>
              )}
              
              <div>
                <h4 className="font-medium text-sm mb-1">Commitment Ledger:</h4>
                <div className="text-sm text-muted-foreground">
                  <p><strong>Asserts:</strong> {outlineResult.skeleton.commitmentLedger.asserts.join("; ") || "None identified"}</p>
                  <p><strong>Rejects:</strong> {outlineResult.skeleton.commitmentLedger.rejects.join("; ") || "None identified"}</p>
                  <p><strong>Assumes:</strong> {outlineResult.skeleton.commitmentLedger.assumes.join("; ") || "None identified"}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">Full Document Generator</CardTitle>
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300">
                Pipeline Test
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={fullDocModel} onValueChange={setFullDocModel}>
                <SelectTrigger className="w-28 h-8" data-testid="select-fulldoc-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearFullDoc}
                data-testid="button-clear-fulldoc"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-blue-700">
                Source Document (drag & drop text file here)
              </label>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => fullDocFileRef.current?.click()}
                className="text-blue-600 h-auto p-0"
                data-testid="button-upload-fulldoc"
              >
                <Upload className="h-3 w-3 mr-1" />
                Upload document
              </Button>
              <input
                ref={fullDocFileRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={(e) => handleFileUpload(e, setFullDocDocument)}
              />
            </div>
            <Textarea
              value={fullDocDocument}
              onChange={(e) => setFullDocDocument(e.target.value)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, setFullDocDocument)}
              placeholder="Paste, type, or drag & drop a text file here..."
              className="min-h-[120px] resize-y"
              data-testid="textarea-fulldoc-document"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-blue-700 block mb-1">
                Target Word Count
              </label>
              <Input
                type="number"
                value={fullDocTargetWords}
                onChange={(e) => setFullDocTargetWords(e.target.value)}
                min={100}
                max={300000}
                placeholder="5000"
                data-testid="input-fulldoc-targetwords"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-blue-700 block mb-1">
                Optional Instructions
              </label>
              <Input
                value={fullDocInstructions}
                onChange={(e) => setFullDocInstructions(e.target.value)}
                placeholder="e.g., 'Turn this into a 7000 word essay'"
                data-testid="input-fulldoc-instructions"
              />
            </div>
          </div>
          
          <Button
            onClick={generateFullDocument}
            disabled={fullDocLoading || !fullDocDocument.trim()}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
            data-testid="button-generate-fulldoc"
          >
            {fullDocLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {fullDocStatus || "Processing..."}
              </>
            ) : (
              <>
                <Layers className="h-4 w-4 mr-2" />
                Generate Full Document
              </>
            )}
          </Button>
          
          {fullDocLoading && fullDocProgress.total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{fullDocPhase}</span>
                <span className="text-muted-foreground">
                  Chunk {fullDocProgress.current}/{fullDocProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(fullDocProgress.current / fullDocProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          
          {fullDocError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{fullDocError}</span>
              </div>
            </div>
          )}
          
          {fullDocOutput && (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="font-medium text-sm">Generated Output:</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">
                    {fullDocOutput.split(/\s+/).filter(w => w.length > 0).length} words
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(fullDocOutput, 'Document')}
                    data-testid="button-copy-fulldoc"
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadAsFile(fullDocOutput, 'generated-document.txt')}
                    data-testid="button-download-fulldoc"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              <div className="max-h-[400px] overflow-y-auto p-4 bg-muted/50 rounded-md">
                <pre className="whitespace-pre-wrap text-sm font-serif">{fullDocOutput}</pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
