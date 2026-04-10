import { useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import type { A2UIWidgetPayload } from '../../agent/a2ui';

export function useAgentMessages() {
  const { addStep, setStatus, setError, addWidget, dismissWidget, updateWidget } = useAgentStore();

  useEffect(() => {
    const handleMessage = (message: { type: string; payload?: unknown }) => {
      switch (message.type) {
        case 'AGENT_STEP':
          addStep(message.payload as { type: 'seeing' | 'thinking' | 'clicking' | 'typing' | 'verifying' | 'error' | 'paused' | 'learning'; description: string; screenshot?: string });
          break;
        case 'AGENT_STATE':
        case 'AGENT_STATUS':
          setStatus((message.payload as { status?: string; state?: string }).status as any || (message.payload as { state?: string }).state as any || 'idle');
          break;
        case 'AGENT_COMPLETE':
          setStatus('complete');
          break;
        case 'AGENT_ERROR':
          setError((message.payload as { error: string }).error);
          break;
        // A2UI Widget Events
        case 'A2UI_RENDER_WIDGET':
          addWidget(message.payload as A2UIWidgetPayload);
          break;
        case 'A2UI_DISMISS_WIDGET':
          dismissWidget((message.payload as { widgetId: string }).widgetId);
          break;
        case 'A2UI_UPDATE_WIDGET':
          updateWidget(
            (message.payload as { widgetId: string }).widgetId,
            message.payload as Partial<A2UIWidgetPayload>
          );
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addStep, setStatus, setError, addWidget, dismissWidget, updateWidget]);
}
