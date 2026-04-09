import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Mic } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export default function TaskInput() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { status, startTask } = useAgentStore();
  const isRunning = status !== 'idle' && status !== 'complete' && status !== 'error';

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  }, [input]);

  // Listen for voice input from popup
  useEffect(() => {
    const handleMessage = (message: { type: string; payload?: { text: string } }) => {
      if (message.type === 'VOICE_INPUT' && message.payload?.text) {
        setInput(message.payload.text);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const openVoicePopup = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('voice.html'),
      type: 'popup',
      width: 450,
      height: 500,
      focused: true
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning) return;
    startTask(input.trim());
    setInput('');
  };

  const suggestions = [
    "Fill this form with my saved data",
    "Extract all items into a table",
    "Clean up and organize this board",
    "Find and collect all events",
  ];

  return (
    <div className="p-4 border-b border-handoff-surface">
      <form onSubmit={handleSubmit} className="relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What should I do on this page?"
          disabled={isRunning}
          className="w-full bg-handoff-surface text-white placeholder-handoff-muted rounded-xl px-4 py-3 pr-24 resize-none focus:outline-none focus:ring-2 focus:ring-handoff-primary/50 disabled:opacity-50 overflow-y-auto"
          rows={2}
          style={{ maxHeight: '160px' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <div className="absolute right-3 bottom-3 flex gap-2">
          <button
            type="button"
            onClick={openVoicePopup}
            disabled={isRunning}
            className="p-2 rounded-lg transition-colors bg-handoff-surface hover:bg-handoff-dark disabled:opacity-50 disabled:cursor-not-allowed"
            title="Voice input"
          >
            <Mic className="w-4 h-4 text-handoff-muted" />
          </button>
          <button
            type="submit"
            disabled={!input.trim() || isRunning}
            className="p-2 bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </form>

      {status === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setInput(suggestion)}
              className="text-xs bg-handoff-surface hover:bg-handoff-surface/80 text-handoff-muted hover:text-white px-3 py-1.5 rounded-full transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
