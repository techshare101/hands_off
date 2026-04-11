import React, { useState } from 'react';
import { useAgentStore } from '../store/agentStore';
import { useAgentMessages } from './hooks/useAgentMessages';
import Header from './components/Header';
import TaskInput from './components/TaskInput';
import ActionFeed from './components/ActionFeed';
import Controls from './components/Controls';
import Settings from './components/Settings';
import LearningPanel from './components/LearningPanel';
import ConnectHub from './components/ConnectHub';

export default function App() {
  const { status, currentTask } = useAgentStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [showConnectHub, setShowConnectHub] = useState(false);
  
  // Listen for messages from background worker
  useAgentMessages();

  return (
    <div className="flex flex-col h-screen bg-handoff-dark">
      <Header onSettingsClick={() => setShowSettings(true)} onLearningClick={() => setShowLearning(true)} onConnectHubClick={() => setShowConnectHub(true)} />
      <Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <LearningPanel isOpen={showLearning} onClose={() => setShowLearning(false)} />
      <ConnectHub isOpen={showConnectHub} onClose={() => setShowConnectHub(false)} />
      
      <main className="flex-1 overflow-hidden flex flex-col">
        <TaskInput />
        
        {currentTask && (
          <>
            <ActionFeed />
            <Controls />
          </>
        )}
        
        {!currentTask && status === 'idle' && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="text-6xl mb-4">🤲</div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Ready to HandOff
              </h2>
              <p className="text-handoff-muted text-sm max-w-xs">
                Describe what you want done on this page. 
                The agent will see, click, type, and verify — just like you would.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
