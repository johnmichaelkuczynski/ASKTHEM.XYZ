import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Download, Maximize2, Minimize2, Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

interface StreamingOutputPopupProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  isGenerating: boolean;
  wordCount?: number;
  onStop?: () => void;
  filename?: string;
}

export function StreamingOutputPopup({
  isOpen,
  onOpenChange,
  title,
  content,
  isGenerating,
  wordCount,
  onStop,
  filename = "output.txt",
}: StreamingOutputPopupProps) {
  const { toast } = useToast();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [miniExpanded, setMiniExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  useEffect(() => {
    if (!isOpen) {
      setIsMinimized(false);
      setIsMaximized(false);
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copied to clipboard",
      description: `${actualWordCount.toLocaleString()} words copied`,
    });
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded",
      description: filename,
    });
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    setMiniExpanded(true);
  };

  const handleExpand = () => {
    setIsMinimized(false);
  };

  const handleClose = () => {
    setIsMinimized(false);
    onOpenChange(false);
  };

  const actualWordCount = wordCount || content.split(/\s+/).filter(w => w.length > 0).length;

  if (isMinimized && isOpen) {
    return (
      <div 
        className="fixed bottom-4 right-4 z-50 bg-background border rounded-lg shadow-lg overflow-hidden"
        style={{ width: miniExpanded ? '380px' : '380px' }}
        data-testid="mini-streaming-popup"
      >
        <div className="flex items-center justify-between p-2 bg-muted/50 border-b cursor-pointer"
             onClick={() => setMiniExpanded(!miniExpanded)}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isGenerating && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-primary" />}
            <span className="text-sm font-medium truncate">{title}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {actualWordCount.toLocaleString()} words
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setMiniExpanded(!miniExpanded); }}>
              {miniExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleExpand(); }} data-testid="button-mini-expand">
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleClose(); }} data-testid="button-mini-close">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        
        {miniExpanded && (
          <>
            <div 
              ref={scrollRef}
              className="h-48 overflow-y-auto p-3 text-sm"
              onScroll={(e) => {
                const el = e.currentTarget;
                const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
                setAutoScroll(isAtBottom);
              }}
            >
              {content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{content}</ReactMarkdown>
                  {isGenerating && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {isGenerating ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating...</span>
                    </div>
                  ) : (
                    <span>No content yet</span>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-2 border-t flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} disabled={!content}>
                  <Copy className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} disabled={!content}>
                  <Download className="h-3 w-3" />
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                {isGenerating ? "Streaming..." : "Complete"}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <Dialog open={isOpen && !isMinimized} onOpenChange={onOpenChange}>
      <DialogContent 
        className={`${isMaximized ? 'max-w-[95vw] h-[95vh]' : 'max-w-4xl h-[80vh]'} flex flex-col p-0`}
        onInteractOutside={(e) => {
          if (isGenerating) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="p-4 pb-2 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating...</span>
                </div>
              )}
              <span className="text-sm text-muted-foreground" data-testid="text-popup-word-count">
                {actualWordCount.toLocaleString()} words
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={!content}
                data-testid="button-popup-copy"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownload}
                disabled={!content}
                data-testid="button-popup-download"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMaximized(!isMaximized)}
                data-testid="button-popup-maximize"
              >
                {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              {isGenerating && onStop && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStop}
                  data-testid="button-popup-stop"
                >
                  Stop
                </Button>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            Streaming output for {title}
          </DialogDescription>
        </DialogHeader>
        
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            setAutoScroll(isAtBottom);
          }}
        >
          {content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
              {isGenerating && (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              {isGenerating ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>Generating content...</span>
                </div>
              ) : (
                <span>No content yet</span>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t flex-shrink-0 flex items-center justify-between bg-muted/30">
          <div className="text-sm text-muted-foreground">
            {isGenerating ? "Content is being generated..." : "Generation complete"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoScroll(true)}
              disabled={autoScroll}
            >
              Auto-scroll
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMinimize}
              data-testid="button-popup-minimize"
            >
              <Minimize2 className="h-3 w-3 mr-1" />
              Minimize
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-popup-close"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
