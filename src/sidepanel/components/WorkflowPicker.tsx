// 📝 WORKFLOW PICKER — Select and replay saved automations
// Users are crying for: "I have to re-teach it the same thing every time"

import { useState, useEffect } from 'react';
import { Clock, Star, Search, Plus, Trash2, ChevronRight, Sparkles } from 'lucide-react';
import { workflowMemory, SavedWorkflow } from '../../agent/workflowMemory';

interface WorkflowPickerProps {
  isVisible: boolean;
  currentUrl?: string;
  onSelect: (workflow: SavedWorkflow) => void;
  onClose: () => void;
  onNewTask: () => void;
}

export default function WorkflowPicker({
  isVisible,
  currentUrl,
  onSelect,
  onClose,
  onNewTask,
}: WorkflowPickerProps) {
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [suggested, setSuggested] = useState<SavedWorkflow[]>([]);

  useEffect(() => {
    if (isVisible) {
      loadWorkflows();
    }
  }, [isVisible, currentUrl]);

  const loadWorkflows = async () => {
    setIsLoading(true);
    try {
      const all = await workflowMemory.getAllWorkflows();
      setWorkflows(all);

      // Find suggested workflows for current page
      if (currentUrl) {
        const matches = await workflowMemory.findMatchingWorkflows(currentUrl, '');
        setSuggested(matches.slice(0, 3));
      }
    } catch (error) {
      console.error('[WorkflowPicker] Failed to load:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await workflowMemory.searchWorkflows(query);
      setWorkflows(results);
    } else {
      const all = await workflowMemory.getAllWorkflows();
      setWorkflows(all);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await workflowMemory.deleteWorkflow(id);
    loadWorkflows();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-handoff-surface rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-handoff-dark">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Saved Workflows</h2>
            <button
              onClick={onClose}
              className="text-handoff-muted hover:text-white text-sm"
            >
              Cancel
            </button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-handoff-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search workflows..."
              className="w-full bg-handoff-dark text-white text-sm placeholder-handoff-muted rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-handoff-primary"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-handoff-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Suggested for this page */}
              {suggested.length > 0 && !searchQuery && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs font-medium text-yellow-400">Suggested for this page</span>
                  </div>
                  <div className="space-y-2">
                    {suggested.map((workflow) => (
                      <WorkflowCard
                        key={workflow.id}
                        workflow={workflow}
                        onSelect={() => onSelect(workflow)}
                        onDelete={(e) => handleDelete(workflow.id, e)}
                        highlighted
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* All workflows */}
              {workflows.length > 0 ? (
                <div>
                  {suggested.length > 0 && !searchQuery && (
                    <div className="text-xs text-handoff-muted mb-2">All workflows</div>
                  )}
                  <div className="space-y-2">
                    {workflows
                      .filter(w => !suggested.some(s => s.id === w.id))
                      .map((workflow) => (
                        <WorkflowCard
                          key={workflow.id}
                          workflow={workflow}
                          onSelect={() => onSelect(workflow)}
                          onDelete={(e) => handleDelete(workflow.id, e)}
                        />
                      ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-handoff-dark rounded-full flex items-center justify-center mx-auto mb-3">
                    <Clock className="w-6 h-6 text-handoff-muted" />
                  </div>
                  <p className="text-handoff-muted text-sm mb-1">No saved workflows</p>
                  <p className="text-handoff-muted text-xs">
                    Complete a task to save it as a workflow
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-handoff-dark">
          <button
            onClick={onNewTask}
            className="w-full flex items-center justify-center gap-2 bg-handoff-primary hover:bg-handoff-primary/80 text-white font-medium py-2.5 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onSelect,
  onDelete,
  highlighted = false,
}: {
  workflow: SavedWorkflow;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  highlighted?: boolean;
}) {
  const successColor = workflow.successRate >= 0.8 ? 'text-green-400' : 
                       workflow.successRate >= 0.5 ? 'text-yellow-400' : 'text-red-400';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl transition-colors group ${
        highlighted 
          ? 'bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20' 
          : 'bg-handoff-dark hover:bg-handoff-dark/70'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{workflow.name}</span>
            {workflow.useCount > 5 && (
              <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-handoff-muted truncate mt-0.5">{workflow.task}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-handoff-muted">
            <span>{workflow.steps.length} steps</span>
            <span className={successColor}>{Math.round(workflow.successRate * 100)}% success</span>
            <span>Used {workflow.useCount}x</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onDelete}
            className="p-1.5 text-handoff-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="p-1.5 text-handoff-muted group-hover:text-handoff-primary transition-colors">
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </button>
  );
}
