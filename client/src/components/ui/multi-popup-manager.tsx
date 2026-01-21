import { usePopupManager } from "@/contexts/popup-manager-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Download, Maximize2, Minimize2, Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export function MultiPopupManager() {
  const { popups, activePopupId, closePopup, minimizePopup, expandPopup } = usePopupManager();
  const { toast } = useToast();
  const [isMaximized, setIsMaximized] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activePopup = popups.find((p) => p.id === activePopupId && !p.isMinimized);
  const minimizedPopups = popups.filter((p) => p.isMinimized);

  useEffect(() => {
    if (autoScroll && scrollRef.current && activePopup) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activePopup?.content, autoScroll]);

  const handleCopy = (content: string, wordCount: number) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copied to clipboard",
      description: `${wordCount.toLocaleString()} words copied`,
    });
  };

  const handleDownload = (content: string, filename: string) => {
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

  const getWordCount = (content: string) => {
    return content.split(/\s+/).filter((w) => w.length > 0).length;
  };

  if (popups.length === 0) return null;

  return (
    <>
      {activePopup && (
        <Dialog open={true} onOpenChange={() => minimizePopup(activePopup.id)}>
          <DialogContent
            className={`${isMaximized ? "max-w-[95vw] h-[95vh]" : "max-w-4xl h-[80vh]"} flex flex-col p-0`}
            onInteractOutside={(e) => {
              if (activePopup.isGenerating) {
                e.preventDefault();
              }
            }}
          >
            <DialogHeader className="p-4 pb-2 border-b flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-lg">{activePopup.title}</DialogTitle>
                  {activePopup.isGenerating && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating...</span>
                    </div>
                  )}
                  <span className="text-sm text-muted-foreground" data-testid="text-popup-word-count">
                    {getWordCount(activePopup.content).toLocaleString()} words
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(activePopup.content, getWordCount(activePopup.content))}
                    disabled={!activePopup.content}
                    data-testid="button-popup-copy"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(activePopup.content, activePopup.filename || "output.txt")}
                    disabled={!activePopup.content}
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
                  {activePopup.isGenerating && activePopup.onStop && (
                    <Button variant="destructive" size="sm" onClick={activePopup.onStop} data-testid="button-popup-stop">
                      Stop
                    </Button>
                  )}
                </div>
              </div>
              <DialogDescription className="sr-only">Streaming output for {activePopup.title}</DialogDescription>
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
              {activePopup.content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{activePopup.content}</ReactMarkdown>
                  {activePopup.isGenerating && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {activePopup.isGenerating ? (
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
                {activePopup.isGenerating ? "Content is being generated..." : "Generation complete"}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setAutoScroll(true)} disabled={autoScroll}>
                  Auto-scroll
                </Button>
                <Button variant="outline" size="sm" onClick={() => minimizePopup(activePopup.id)} data-testid="button-popup-minimize">
                  <Minimize2 className="h-3 w-3 mr-1" />
                  Minimize
                </Button>
                <Button variant="default" size="sm" onClick={() => closePopup(activePopup.id)} data-testid="button-popup-close">
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {minimizedPopups.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" data-testid="minimized-popups-container">
          {minimizedPopups.map((popup, index) => (
            <MinimizedPopupCard
              key={popup.id}
              popup={popup}
              onExpand={() => expandPopup(popup.id)}
              onClose={() => closePopup(popup.id)}
              onCopy={() => handleCopy(popup.content, getWordCount(popup.content))}
              onDownload={() => handleDownload(popup.content, popup.filename || "output.txt")}
              style={{ zIndex: 50 + index }}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface MinimizedPopupCardProps {
  popup: {
    id: string;
    title: string;
    content: string;
    isGenerating: boolean;
  };
  onExpand: () => void;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  style?: React.CSSProperties;
}

function MinimizedPopupCard({ popup, onExpand, onClose, onCopy, onDownload, style }: MinimizedPopupCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const wordCount = popup.content.split(/\s+/).filter((w) => w.length > 0).length;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [popup.content]);

  return (
    <div
      className="bg-background border rounded-lg shadow-lg overflow-hidden"
      style={{ width: "380px", ...style }}
      data-testid={`mini-popup-${popup.id}`}
    >
      <div
        className="flex items-center justify-between p-2 bg-muted/50 border-b cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {popup.isGenerating && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-primary" />}
          <span className="text-sm font-medium truncate">{popup.title}</span>
          <span className="text-xs text-muted-foreground flex-shrink-0">{wordCount.toLocaleString()} words</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            data-testid="button-mini-expand"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            data-testid="button-mini-close"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <>
          <div ref={scrollRef} className="h-48 overflow-y-auto p-3 text-sm">
            {popup.content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{popup.content}</ReactMarkdown>
                {popup.isGenerating && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                {popup.isGenerating ? (
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCopy} disabled={!popup.content}>
                <Copy className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload} disabled={!popup.content}>
                <Download className="h-3 w-3" />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{popup.isGenerating ? "Streaming..." : "Complete"}</span>
          </div>
        </>
      )}
    </div>
  );
}
