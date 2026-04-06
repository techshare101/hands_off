import { useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';

export function useAgentMessages() {
  const { addStep, setStatus, setError } = useAgentStore();

  useEffect(() => {
    const handleMessage = (message: { type: string; payload?: unknown }) => {
      switch (message.type) {
        case 'AGENT_STEP':
          addStep(message.payload as { type: 'seeing' | 'thinking' | 'clicking' | 'typing' | 'verifying' | 'error' | 'paused' | 'learning'; description: string; screenshot?: string });
          break;
        case 'AGENT_STATUS':
          setStatus((message.payload as { status: 'idle' | 'seeing' | 'thinking' | 'acting' | 'verifying' | 'paused' | 'error' | 'complete' }).status);
          break;
        case 'AGENT_COMPLETE':
          setStatus('complete');
          break;
        case 'AGENT_ERROR':
          setError((message.payload as { error: string }).error);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addStep, setStatus, setError]);
}
