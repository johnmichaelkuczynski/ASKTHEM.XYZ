import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Download, FileText, Upload, X, ArrowRight, HelpCircle, Copy, Check, ClipboardList, Move, Maximize2 } from "lucide-react";
import type { Figure, FigureMessage, PersonaSettings } from "@shared/schema";
import { PaperWriter } from "@/components/paper-writer";
import { WhatToAskModal } from "@/components/what-to-ask-modal";
import { ThinkingPanel } from "@/components/thinking-panel";
import { AuditPanel } from "@/components/audit-panel";
import type { AuditStep, AuditReport } from "../../../shared/audit-types";

import jamesAvatar from "@assets/james.png";
import gardnerAvatar from "@assets/gardner.png";
import weylAvatar from "@assets/weyl.png";

const customAvatars: Record<string, string> = {
  "james": jamesAvatar,
  "gardner": gardnerAvatar,
  "weyl": weylAvatar,
};

interface FigureChatProps {
  figure: Figure | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferContent?: (content: string, target: 'chat' | 'model' | 'paper' | 'dialogue') => void;
}

export function FigureChat({ figure, open, onOpenChange, onTransferContent }: FigureChatProps) {
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState("");
  const [messageCountBeforePending, setMessageCountBeforePending] = useState<number>(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [paperWriterOpen, setPaperWriterOpen] = useState(false);
  const [whatToAskOpen, setWhatToAskOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | number | null>(null);
  const [auditPanelOpen, setAuditPanelOpen] = useState(false);
  const [auditData, setAuditData] = useState<AuditReport | null>(null);
  const [streamingAuditSteps, setStreamingAuditSteps] = useState<AuditStep[]>([]);
  
  // Window position and size state
  const [windowPos, setWindowPos] = useState({ x: 50, y: 50 }); // pixels from top-left
  const [windowSize, setWindowSize] = useState({ width: 800, height: 600 }); // pixels
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  
  // Drag handlers for moving window
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    e.preventDefault();
    isDragging.current = true;
    dragOffset.current = { 
      x: e.clientX - windowPos.x, 
      y: e.clientY - windowPos.y 
    };
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [windowPos]);
  
  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y));
    setWindowPos({ x: newX, y: newY });
  }, []);
  
  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
  }, [handleDragMove]);
  
  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, []);
  
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(280, Math.min(window.innerWidth - windowPos.x - 20, e.clientX - windowPos.x));
    const newHeight = Math.max(200, Math.min(window.innerHeight - windowPos.y - 20, e.clientY - windowPos.y));
    setWindowSize({ width: newWidth, height: newHeight });
  }, [windowPos]);
  
  const handleResizeEnd = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  }, [handleResizeMove]);
  
  // Reset to full size
  const handleMaximize = useCallback(() => {
    setWindowPos({ x: 20, y: 20 });
    setWindowSize({ width: window.innerWidth - 40, height: window.innerHeight - 40 });
  }, []);

  const handleCopyMessage = async (messageId: string | number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const { data: messages = [] } = useQuery<FigureMessage[]>({
    queryKey: [`/api/figures/${figure?.id}/messages`],
    enabled: !!figure && open,
  });

  // Fetch persona settings to pass with chat requests
  const { data: personaSettings } = useQuery<PersonaSettings>({
    queryKey: ["/api/persona-settings"],
  });

  // CRITICAL FIX: Reset input and uploaded file when figure changes or dialog closes
  useEffect(() => {
    // Clear state when dialog closes OR when figure changes (even if dialog stays open)
    setInput("");
    setUploadedFile(null);
    setStreamingMessage("");
    setPendingAssistantMessage("");
  }, [figure?.id, open]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!figure) return;

      setIsStreaming(true);
      setStreamingMessage("");
      setPendingAssistantMessage("");
      setStreamingAuditSteps([]);
      setAuditData(null);

      const response = await fetch(`/api/figures/${figure.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          message,
          uploadedDocument: uploadedFile ? {
            name: uploadedFile.name,
            content: uploadedFile.content
          } : undefined,
          // Pass settings directly to avoid session mismatch issues
          settings: personaSettings ? {
            responseLength: personaSettings.responseLength || 750,
            quoteFrequency: personaSettings.quoteFrequency || 0,
            selectedModel: personaSettings.selectedModel || "zhi5",
            enhancedMode: personaSettings.enhancedMode ?? true,
            dialogueMode: personaSettings.dialogueMode ?? false,
          } : undefined
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      return new Promise<void>(async (resolve, reject) => {
        try {
          let accumulatedText = ""; // Local accumulator to avoid stale state
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  setIsStreaming(false);
                  // CRITICAL FIX v2: Keep message visible until refetch confirms persistence
                  // Track message count to ensure we wait for the NEW message
                  // Use local accumulator to avoid stale state closure bug
                  const currentMessages = queryClient.getQueryData<FigureMessage[]>([`/api/figures/${figure.id}/messages`]) || [];
                  setMessageCountBeforePending(currentMessages.length);
                  setPendingAssistantMessage(accumulatedText);
                  setStreamingMessage("");
                  queryClient.invalidateQueries({
                    queryKey: [`/api/figures/${figure.id}/messages`],
                  });
                  resolve();
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  if (parsed.content) {
                    accumulatedText += parsed.content;
                    setStreamingMessage(accumulatedText);
                  }
                  if (parsed.auditStep || parsed.auditEvent) {
                    const event = parsed.auditStep || parsed.auditEvent;
                    setStreamingAuditSteps(prev => [...prev, event]);
                  }
                  if (parsed.auditReport || parsed.auditSummary) {
                    const report = parsed.auditReport || parsed.auditSummary;
                    setAuditData(report);
                  }
                  if (parsed.error) {
                    console.error("Streaming error:", parsed.error);
                    setIsStreaming(false);
                    reject(new Error(parsed.error));
                    return;
                  }
                } catch (err) {
                  // Ignore parsing errors for incomplete chunks
                }
              }
            }
          }
        } catch (error) {
          console.error("Stream reading error:", error);
          setIsStreaming(false);
          setStreamingMessage("");
          setPendingAssistantMessage("");
          setMessageCountBeforePending(0);
          reject(error);
        }
      });
    },
  });

  const clearChatMutation = useMutation({
    mutationFn: async () => {
      if (!figure) return;
      const response = await fetch(`/api/figures/${figure.id}/messages`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to clear chat");
    },
    onSuccess: () => {
      if (!figure) return;
      queryClient.invalidateQueries({
        queryKey: [`/api/figures/${figure.id}/messages`],
      });
    },
  });

  const handleSend = () => {
    if (!input.trim() || isStreaming || !figure) return;
    
    const message = input.trim();
    setInput("");
    
    // Auto-open audit panel and clear previous audit data for the new search
    setAuditData(null);
    setAuditPanelOpen(true);
    
    sendMessageMutation.mutate(message);
    setUploadedFile(null); // Clear uploaded file after sending
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (limit to 1MB)
    if (file.size > 1024 * 1024) {
      alert("File too large. Please upload a file smaller than 1MB.");
      return;
    }

    // Check file type
    const allowedTypes = [".txt", ".md", ".doc", ".docx", ".pdf"];
    const fileExtension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    
    if (!allowedTypes.includes(fileExtension)) {
      alert("Please upload a text file (.txt, .md, .doc, .docx, or .pdf)");
      return;
    }

    try {
      const text = await file.text();
      setUploadedFile({
        name: file.name,
        content: text
      });
    } catch (error) {
      console.error("Error reading file:", error);
      alert("Error reading file. Please try again.");
    }
  };

  const handleDownload = () => {
    if (!figure || messages.length === 0) return;

    const timestamp = new Date().toLocaleString();
    let content = `Conversation with ${figure.name}\n`;
    content += `${figure.title}\n`;
    content += `Downloaded: ${timestamp}\n`;
    content += `${'='.repeat(60)}\n\n`;

    messages.forEach((message) => {
      const role = message.role === 'user' ? 'You' : figure.name;
      content += `${role}:\n${message.content}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${figure.name.replace(/\s+/g, '_')}_conversation_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Clear pending message once it appears in the fetched messages
  useEffect(() => {
    if (pendingAssistantMessage && messages.length > 0) {
      // Only clear if message count has increased (confirming new message was persisted)
      if (messages.length > messageCountBeforePending) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === "assistant" && lastMessage.content === pendingAssistantMessage) {
          setPendingAssistantMessage("");
          setMessageCountBeforePending(0);
        }
      }
    }
  }, [messages, pendingAssistantMessage, messageCountBeforePending]);

  // Only scroll during active streaming, not after response is saved
  const isActivelyStreaming = streamingMessage && streamingMessage.length > 0;
  
  useEffect(() => {
    if (messagesEndRef.current && isActivelyStreaming) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isActivelyStreaming, streamingMessage]);

  if (!figure || !open) return null;

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
      />
      
      {/* Floating resizable window */}
      <div
        ref={windowRef}
        className="fixed z-50 bg-background rounded-lg shadow-2xl border-2 border-border flex flex-col overflow-hidden"
        style={{
          left: windowPos.x,
          top: windowPos.y,
          width: windowSize.width,
          height: windowSize.height,
        }}
      >
        {/* Draggable header */}
        <div 
          className="px-4 py-3 border-b bg-muted cursor-move flex items-center gap-3 select-none"
          onMouseDown={handleDragStart}
        >
          <Move className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="relative flex-shrink-0">
            {(() => {
              const figureName = figure.name.toLowerCase().split(' ').pop() || '';
              const customAvatar = customAvatars[figureName];
              const iconSrc = customAvatar || figure.icon;
              const isImageIcon = customAvatar || iconSrc.startsWith('/') || iconSrc.startsWith('http');
              
              if (isImageIcon) {
                return (
                  <img 
                    src={iconSrc} 
                    alt={figure.name}
                    className={`w-10 h-10 rounded-full object-cover border-2 border-primary/20 ${isStreaming ? 'animate-pulse' : ''}`}
                  />
                );
              }
              return <span className="text-2xl">{figure.icon}</span>;
            })()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{figure.name}</h2>
            <p className="text-xs text-muted-foreground truncate">{figure.title}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button size="icon" variant="ghost" onClick={handleMaximize} title="Maximize">
              <Maximize2 className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onOpenChange(false)} title="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Toolbar */}
        <div className="px-4 py-2 border-b flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWhatToAskOpen(true)}
            data-testid="button-what-to-ask"
          >
            <HelpCircle className="w-4 h-4 mr-1" />
            What to Ask
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setPaperWriterOpen(true)}
            data-testid="button-write-paper"
          >
            <FileText className="w-4 h-4 mr-1" />
            Write Paper
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={messages.length === 0}
            data-testid="button-download-chat"
          >
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearChatMutation.mutate()}
            disabled={clearChatMutation.isPending || messages.length === 0}
            data-testid="button-clear-chat"
          >
            Clear Chat
          </Button>
          <Button
            variant={auditPanelOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setAuditPanelOpen(!auditPanelOpen)}
            data-testid="button-audit-trail"
            title="View search audit trail"
          >
            <ClipboardList className="w-4 h-4 mr-1" />
            Audit
          </Button>
        </div>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-4 py-4">
            {messages.length === 0 && !streamingMessage && !pendingAssistantMessage && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  Start a conversation with {figure.name}
                </p>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === "user";
              
              return (
                <div
                  key={message.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  data-testid={`figure-message-${message.id}`}
                >
                  <div className={`max-w-[80%] space-y-2 flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                    <div
                      className={`rounded-lg px-4 py-3 ${
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {!isUser && (
                      <div className="flex items-center justify-between w-full">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyMessage(message.id, message.content)}
                            className="text-xs"
                            data-testid={`button-copy-${message.id}`}
                          >
                            {copiedMessageId === message.id ? (
                              <>
                                <Check className="h-3 w-3 mr-1 text-green-500" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (onTransferContent) {
                                onTransferContent(message.content, 'model');
                                onOpenChange(false); // Close dialog
                              } else {
                                // Fallback: scroll to Model Builder section on main page
                                onOpenChange(false);
                                setTimeout(() => {
                                  document.getElementById('model-builder-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                              }
                            }}
                            className="text-xs"
                            data-testid={`button-model-builder-${message.id}`}
                          >
                            Send to Model Builder
                            <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded" data-testid={`word-count-${message.id}`}>
                          {message.content.split(/\s+/).filter(w => w.length > 0).length.toLocaleString()} words
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {streamingMessage && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-4 py-3 bg-muted">
                  <p className="text-sm whitespace-pre-wrap">{streamingMessage}</p>
                  <span className="inline-block w-1 h-4 bg-foreground/50 ml-0.5 animate-pulse" />
                </div>
              </div>
            )}

            {pendingAssistantMessage && !streamingMessage && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-4 py-3 bg-muted">
                  <p className="text-sm whitespace-pre-wrap">{pendingAssistantMessage}</p>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t">
          {uploadedFile && (
            <div className="mb-3 p-3 bg-muted rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">{uploadedFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({(uploadedFile.content.length / 1024).toFixed(1)}KB)
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUploadedFile(null)}
                data-testid="button-remove-upload"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.doc,.docx,.pdf"
              onChange={handleFileUpload}
              className="hidden"
              data-testid="input-file-upload"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              data-testid="button-upload-file"
              className="h-10 flex-shrink-0"
              title="Upload document for analysis"
            >
              <Upload className="w-4 h-4" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={uploadedFile ? `Ask ${figure.name} to analyze, evaluate, or rewrite the uploaded document...` : `Ask ${figure.name} a question...`}
              disabled={isStreaming}
              data-testid="input-figure-message"
              className="min-h-[120px] resize-none"
              rows={5}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              data-testid="button-send-figure-message"
              className="h-10 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Resize handle - bottom right corner */}
        <div 
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize bg-gradient-to-tl from-muted-foreground/30 to-transparent rounded-tl-sm"
          data-testid="handle-resize-dialog"
          title="Drag to resize"
        />
      </div>
      
      <PaperWriter 
        figure={figure}
        open={paperWriterOpen}
        onOpenChange={setPaperWriterOpen}
      />

      <WhatToAskModal
        open={whatToAskOpen}
        onOpenChange={setWhatToAskOpen}
        figureName={figure.name}
        figureId={figure.id}
        onSelectPrompt={(prompt) => {
          // Open audit panel and clear previous data before sending
          setAuditData(null);
          setAuditPanelOpen(true);
          sendMessageMutation.mutate(prompt);
        }}
      />
      
      <AuditPanel
        isOpen={auditPanelOpen}
        onClose={() => setAuditPanelOpen(false)}
        auditData={auditData}
        streamingSteps={streamingAuditSteps}
        isStreaming={isStreaming}
      />
    </>
  );
}
