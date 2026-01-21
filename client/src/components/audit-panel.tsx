import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Download, X, Search, Database, CheckCircle, XCircle, AlertCircle, Cpu, FileText } from 'lucide-react';
import type { AuditStep, AuditReport } from '../../../shared/audit-types';

interface AuditPanelProps {
  isOpen: boolean;
  onClose: () => void;
  auditData: AuditReport | null;
  streamingSteps: AuditStep[];
  isStreaming: boolean;
}

function StepIcon({ type }: { type: string }) {
  switch (type) {
    case 'query':
      return <Database className="w-4 h-4 text-blue-500" />;
    case 'table_search':
      return <Search className="w-4 h-4 text-purple-500" />;
    case 'passage_examined':
    case 'passage_found':
      return <FileText className="w-4 h-4 text-blue-400" />;
    case 'passage_accepted':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'passage_rejected':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'direct_answer_found':
    case 'direct_answer':
      return <CheckCircle className="w-4 h-4 text-amber-500" />;
    case 'alignment_check':
      return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    case 'search_complete':
    case 'final_decision':
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    case 'no_direct_answer':
      return <AlertCircle className="w-4 h-4 text-orange-500" />;
    case 'llm_call':
      return <Cpu className="w-4 h-4 text-cyan-500" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-red-600" />;
    default:
      return <Database className="w-4 h-4" />;
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().split('T')[1].split('.')[0];
}

function generateTextReport(data: AuditReport): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    AUDIT REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Question: ${data.question}`);
  lines.push(`Author: ${data.authorName} (${data.authorId})`);
  lines.push(`Timestamp: ${new Date(data.timestamp).toISOString()}`);
  lines.push(`Answer Type: ${data.answerType || 'standard'}`);
  lines.push(`Model: ${data.model || data.llmUsage?.model || 'unknown'}`);
  lines.push('');
  
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    EXECUTION TRACE');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');
  
  const events = data.executionTrace || data.events || [];
  for (const event of events) {
    const time = new Date(event.timestamp).toISOString().substring(11, 23);
    lines.push(`[${time}] ${String(event.type).toUpperCase()}: ${event.detail || ''}`);
    if (event.data && typeof event.data === 'object' && Object.keys(event.data).length > 0) {
      lines.push(`           Data: ${JSON.stringify(event.data)}`);
    }
  }
  
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    TABLES SEARCHED');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');
  lines.push(data.tablesSearched?.join(', ') || 'positions, quotes, chunks');
  
  if (data.directAnswersFound && data.directAnswersFound.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                    DIRECT ANSWERS FOUND');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');
    for (let i = 0; i < data.directAnswersFound.length; i++) {
      const da = data.directAnswersFound[i];
      lines.push(`DIRECT ANSWER #${i + 1}`);
      lines.push(`  Source: ${da.source}`);
      if (da.workTitle) lines.push(`  Work: ${da.workTitle}`);
      lines.push(`  Text: "${da.text.substring(0, 300)}${da.text.length > 300 ? '...' : ''}"`);
      lines.push('');
    }
  }
  
  if (data.alignmentResult) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                    ALIGNMENT CHECK');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');
    lines.push(`Result: ${data.alignmentResult.aligned ? 'ALIGNED' : 'CONFLICTING'}`);
    lines.push(`Summary: ${data.alignmentResult.summary}`);
  }
  
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    FINAL ANSWER');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');
  lines.push(data.finalAnswer?.substring(0, 2000) || '[No answer recorded]');
  
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    END OF AUDIT REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

export function AuditPanel({ isOpen, onClose, auditData, streamingSteps, isStreaming }: AuditPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingSteps, isStreaming]);
  
  if (!isOpen) return null;
  
  const displaySteps = isStreaming ? streamingSteps : (auditData?.executionTrace || auditData?.events || []);
  
  const downloadReport = () => {
    if (!auditData) return;
    
    const reportText = generateTextReport(auditData);
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-${auditData.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const downloadJSON = () => {
    if (!auditData) return;
    
    const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-${auditData.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border shadow-lg z-50 flex flex-col">
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          <span className="font-semibold">Audit Trail</span>
          {isStreaming && (
            <Badge variant="secondary" className="animate-pulse">
              Live
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {auditData && (
            <>
              <Button size="icon" variant="ghost" onClick={downloadReport} data-testid="button-download-txt">
                <Download className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={downloadJSON} data-testid="button-download-json">
                <FileText className="w-4 h-4" />
              </Button>
            </>
          )}
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-audit">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1" ref={scrollRef as any}>
        <div className="p-3 space-y-2">
          {displaySteps.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {isStreaming ? 'Waiting for search to start...' : 'No audit data available'}
            </div>
          ) : (
            displaySteps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm">
                <div className="flex-shrink-0 mt-0.5">
                  <StepIcon type={step.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {formatTimestamp(step.timestamp)}
                  </div>
                  <div className="font-medium text-xs uppercase text-muted-foreground">
                    {step.type.replace(/_/g, ' ')}
                  </div>
                  <div className="text-sm break-words">
                    {step.detail}
                  </div>
                  {step.data && typeof step.data === 'object' && Object.keys(step.data).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1 font-mono bg-muted/50 p-1 rounded overflow-hidden">
                      {JSON.stringify(step.data).substring(0, 150)}
                      {JSON.stringify(step.data).length > 150 ? '...' : ''}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      
      {auditData && !isStreaming && (
        <div className="p-3 border-t bg-muted/30">
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Answer Type:</span>
              <Badge variant={auditData.answerType === 'direct' ? 'default' : 'secondary'}>
                {auditData.answerType || 'standard'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Context Size:</span>
              <span>{auditData.contextLength?.toLocaleString() || '?'} chars</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model:</span>
              <span className="text-xs">{auditData.model || auditData.llmUsage?.model || 'unknown'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
