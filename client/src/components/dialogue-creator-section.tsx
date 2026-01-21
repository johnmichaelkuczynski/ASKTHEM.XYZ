import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy, Trash2, Download, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DragDropUpload } from "@/components/ui/drag-drop-upload";
import { useQuery } from "@tanstack/react-query";
import type { Figure } from "@shared/schema";
import { usePopupManager } from "@/contexts/popup-manager-context";

function getDisplayName(fullName: string): string {
  const keepFullName = ["James Allen", "William James", "ALLEN"];
  if (keepFullName.includes(fullName)) {
    return fullName;
  }
  const parts = fullName.split(' ');
  return parts[parts.length - 1];
}

interface DialogueCreatorSectionProps {
  onRegisterInput?: (setter: (content: string) => void) => void;
  onRegisterOutputs?: (outputGetters: Record<string, () => string>) => void;
}

export function DialogueCreatorSection({ 
  onRegisterInput, 
  onRegisterOutputs 
}: DialogueCreatorSectionProps) {
  const [mode, setMode] = useState<'paste' | 'upload'>('paste');
  const [inputText, setInputText] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedAuthor1, setSelectedAuthor1] = useState<string>('');
  const [selectedAuthor2, setSelectedAuthor2] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [dialogue, setDialogue] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [wordLengthInput, setWordLengthInput] = useState<string>('1500');
  const uploadedFileRef = useRef<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedFileSize, setUploadedFileSize] = useState(0);
  const { toast } = useToast();
  const { registerPopup, updatePopup } = usePopupManager();

  // Fetch available authors/figures
  const { data: figures = [] } = useQuery<Figure[]>({
    queryKey: ['/api/figures'],
  });

  // Register input setter for content transfer system
  useEffect(() => {
    if (onRegisterInput) {
      onRegisterInput((content: string) => {
        setInputText(content);
        setMode('paste');
      });
    }
  }, [onRegisterInput]);

  // Register output getters for content transfer
  useEffect(() => {
    if (onRegisterOutputs) {
      onRegisterOutputs({
        dialogue: () => dialogue
      });
    }
  }, [onRegisterOutputs, dialogue]);

  const handleFileAccepted = async (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    // Store the file for backend processing
    uploadedFileRef.current = file;
    setUploadedFileName(file.name);
    setUploadedFileSize(file.size);

    // For preview purposes only, show first part if it's a text file
    if (fileExtension === 'txt') {
      try {
        const text = await file.text();
        setInputText(text.slice(0, 500));
        toast({
          title: "File uploaded",
          description: `${file.name} ready (${file.size} bytes)`,
        });
      } catch (error) {
        setInputText(`File uploaded: ${file.name}`);
        toast({
          title: "File uploaded",
          description: file.name,
        });
      }
    } else {
      setInputText(`File uploaded: ${file.name} (${fileExtension?.toUpperCase() || 'FILE'})`);
      toast({
        title: "File uploaded",
        description: `${file.name} will be processed by server`,
      });
    }
  };

  const handleValidationError = (error: { title: string; description: string }) => {
    toast({
      title: error.title,
      description: error.description,
      variant: "destructive",
    });
  };

  const handleClearFile = () => {
    uploadedFileRef.current = null;
    setUploadedFileName('');
    setUploadedFileSize(0);
    setInputText('');
  };

  const handleGenerate = async () => {
    // Validate input: either uploaded file or pasted text (minimum 5 chars for topic)
    if (!uploadedFileRef.current && (!inputText || inputText.trim().length < 5)) {
      toast({
        title: "Input required",
        description: "Please provide a topic or text (at least 5 characters) or upload a file",
        variant: "destructive",
      });
      return;
    }

    // Validate at least one thinker is selected
    if (!selectedAuthor1 || selectedAuthor1 === 'none') {
      toast({
        title: "Thinker required",
        description: "Please select at least the first thinker",
        variant: "destructive",
      });
      return;
    }

    const wordLength = parseInt(wordLengthInput) || 1500;
    if (wordLength < 100 || wordLength > 50000) {
      toast({
        title: "Invalid word length",
        description: "Please enter a number between 100 and 50,000",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setDialogue('');
    setWordCount(0);
    
    const author1 = figures.find(f => f.id === selectedAuthor1);
    const author2 = selectedAuthor2 && selectedAuthor2 !== 'none' 
      ? figures.find(f => f.id === selectedAuthor2) 
      : null;
    const dialoguePopupId = `dialogue-${Date.now()}`;
    registerPopup({
      id: dialoguePopupId,
      title: `Dialogue: ${author1?.name || "Author"}${author2 ? ` & ${author2.name}` : ""}`,
      content: "",
      isGenerating: true,
      filename: `dialogue_${author1?.name.replace(/\s+/g, '_') || 'author'}.txt`,
    });

    try {
      const formData = new FormData();
      
      // If file was uploaded, send it; otherwise send text
      if (uploadedFileRef.current) {
        formData.append('file', uploadedFileRef.current);
      } else {
        formData.append('text', inputText);
      }
      
      if (customInstructions.trim()) {
        formData.append('customInstructions', customInstructions);
      }
      
      formData.append('wordLength', wordLength.toString());
      
      // Send both thinker selections
      if (selectedAuthor1 && selectedAuthor1 !== 'none') {
        formData.append('authorId1', selectedAuthor1);
      }
      if (selectedAuthor2 && selectedAuthor2 !== 'none') {
        formData.append('authorId2', selectedAuthor2);
      }

      const response = await fetch('/api/dialogue-creator', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate dialogue');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      if (!reader) throw new Error('No reader available');

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
                accumulatedText += parsed.content;
                setDialogue(accumulatedText);
                updatePopup(dialoguePopupId, { content: accumulatedText });
              }
              
              if (parsed.done && parsed.wordCount) {
                setWordCount(parsed.wordCount);
                updatePopup(dialoguePopupId, { isGenerating: false });
              }
              
              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              // Ignore JSON parse errors for non-JSON lines
            }
          }
        }
      }

      toast({
        title: "Dialogue generated",
        description: `Created ${accumulatedText.split(/\s+/).length} word dialogue`,
      });

      // Clear uploaded file after successful generation
      uploadedFileRef.current = null;
      setUploadedFileName('');
      setUploadedFileSize(0);

    } catch (error) {
      console.error('Error generating dialogue:', error);
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
      updatePopup(dialoguePopupId, { isGenerating: false });
    } finally {
      setIsGenerating(false);
      updatePopup(dialoguePopupId, { isGenerating: false });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(dialogue);
      toast({
        title: "Copied!",
        description: "Dialogue copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([dialogue], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dialogue_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Downloaded",
      description: "Dialogue saved as text file",
    });
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this dialogue?')) {
      setDialogue('');
      setWordCount(0);
      toast({
        title: "Deleted",
        description: "Dialogue cleared",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold flex items-center gap-2">
          <MessageSquare className="w-8 h-8" />
          Dialogue Creator
        </h2>
        <p className="text-muted-foreground mt-2">
          Transform non-fiction into authentic philosophical dialogue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
          <CardDescription>
            Enter a topic (e.g., "The merits of rationalism") or paste/upload a full text for transformation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => {
            const newMode = v as 'paste' | 'upload';
            setMode(newMode);
            // Clear uploaded file when switching to paste mode
            if (newMode === 'paste') {
              handleClearFile();
            }
          }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paste" data-testid="tab-paste">Paste Text</TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-upload">Upload File</TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="space-y-4">
              <div>
                <Label htmlFor="input-text">Topic or Text</Label>
                <Textarea
                  id="input-text"
                  data-testid="textarea-input"
                  placeholder="Enter a topic (e.g., 'Discuss the merits of rationalism') or paste a full text..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={8}
                  className="mt-2"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  {inputText.length} characters
                </p>
              </div>
            </TabsContent>

            <TabsContent value="upload" className="space-y-4">
              <div>
                <Label>Upload File</Label>
                <DragDropUpload
                  accept=".txt,.pdf,.doc,.docx"
                  maxSizeBytes={5 * 1024 * 1024}
                  onFileAccepted={handleFileAccepted}
                  onValidationError={handleValidationError}
                  onClear={handleClearFile}
                  currentFileName={uploadedFileName}
                  currentFileSize={uploadedFileSize}
                  data-testid="drag-drop-upload"
                  className="mt-2"
                />
              </div>
              {inputText && uploadedFileName && (
                <div>
                  <Label>Loaded Text Preview</Label>
                  <Textarea
                    value={inputText.slice(0, 500)}
                    readOnly
                    rows={6}
                    className="mt-2 font-mono text-sm"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    {inputText.length} characters loaded
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="author-select-1">
                First Thinker (Required)
              </Label>
              <Select
                value={selectedAuthor1}
                onValueChange={setSelectedAuthor1}
              >
                <SelectTrigger
                  id="author-select-1"
                  data-testid="select-author-1"
                  className="mt-2"
                >
                  <SelectValue placeholder="Select first thinker..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Select Thinker --</SelectItem>
                  {figures.map((figure) => (
                    <SelectItem key={figure.id} value={figure.id}>
                      {getDisplayName(figure.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="author-select-2">
                Second Thinker
              </Label>
              <Select
                value={selectedAuthor2}
                onValueChange={setSelectedAuthor2}
              >
                <SelectTrigger
                  id="author-select-2"
                  data-testid="select-author-2"
                  className="mt-2"
                >
                  <SelectValue placeholder="Select second thinker..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Select Thinker --</SelectItem>
                  <SelectItem value="everyman">Everyman (Non-philosopher)</SelectItem>
                  {figures.map((figure) => (
                    <SelectItem key={figure.id} value={figure.id}>
                      {getDisplayName(figure.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Select two thinkers to dialogue with each other, or select "Everyman" as the second thinker for a philosopher/layperson conversation
          </p>

          <div>
            <Label htmlFor="custom-instructions">Optional Customization</Label>
            <Textarea
              id="custom-instructions"
              data-testid="textarea-customization"
              placeholder="Optional: Specify tone, character types, focus areas, or any other instructions..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={3}
              className="mt-2"
            />
            <p className="text-sm text-muted-foreground mt-1">
              e.g., "Make it more confrontational" or "Focus on the psychological aspects"
            </p>
          </div>

          <div>
            <Label htmlFor="word-length-input">Dialogue Length (100 - 50,000 words)</Label>
            <Input
              id="word-length-input"
              type="number"
              min={100}
              max={50000}
              value={wordLengthInput}
              onChange={(e) => setWordLengthInput(e.target.value)}
              placeholder="Enter desired word count..."
              className="mt-2"
              data-testid="input-word-length"
            />
            <p className="text-sm text-muted-foreground mt-1">
              {parseInt(wordLengthInput) > 2000 
                ? `Will be generated in ${Math.ceil(parseInt(wordLengthInput) / 2000)} chapters using coherence system`
                : "Single generation"
              }
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !inputText || inputText.trim().length < 5 || !selectedAuthor1 || selectedAuthor1 === 'none'}
            className="w-full"
            size="lg"
            data-testid="button-generate"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Dialogue...
              </>
            ) : (
              <>
                <MessageSquare className="mr-2 h-4 w-4" />
                Generate Dialogue
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {dialogue && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Dialogue Output</CardTitle>
                <CardDescription>
                  {wordCount > 0 ? `${wordCount} words generated` : 'Generated dialogue'}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  data-testid="button-download"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  data-testid="button-copy"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  data-testid="button-delete"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="prose dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/50 p-4 rounded-lg text-foreground" data-testid="text-dialogue-output">
                {dialogue}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
