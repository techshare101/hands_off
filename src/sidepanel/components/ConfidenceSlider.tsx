// 🎚️ CONFIDENCE SLIDER — User-controlled autonomy level
// Users are crying for: "I want more control over when it asks me"

import { useState } from 'react';
import { Sliders, Shield, Zap, Brain, Info } from 'lucide-react';

export type AutonomyLevel = 'cautious' | 'balanced' | 'autonomous';

interface ConfidenceSliderProps {
  value: AutonomyLevel;
  onChange: (level: AutonomyLevel) => void;
  disabled?: boolean;
}

const AUTONOMY_LEVELS: {
  level: AutonomyLevel;
  label: string;
  description: string;
  icon: typeof Shield;
  color: string;
  approvalThreshold: number;
}[] = [
  {
    level: 'cautious',
    label: 'Cautious',
    description: 'Ask before every action',
    icon: Shield,
    color: 'text-blue-400',
    approvalThreshold: 1.0, // Always ask
  },
  {
    level: 'balanced',
    label: 'Balanced',
    description: 'Ask for risky or uncertain actions',
    icon: Brain,
    color: 'text-yellow-400',
    approvalThreshold: 0.7, // Ask when confidence < 70%
  },
  {
    level: 'autonomous',
    label: 'Autonomous',
    description: 'Only ask for dangerous actions',
    icon: Zap,
    color: 'text-green-400',
    approvalThreshold: 0.3, // Only ask when very uncertain
  },
];

export function getApprovalThreshold(level: AutonomyLevel): number {
  const config = AUTONOMY_LEVELS.find(l => l.level === level);
  return config?.approvalThreshold ?? 0.7;
}

export default function ConfidenceSlider({
  value,
  onChange,
  disabled = false,
}: ConfidenceSliderProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const currentIndex = AUTONOMY_LEVELS.findIndex(l => l.level === value);
  const currentConfig = AUTONOMY_LEVELS[currentIndex];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value);
    onChange(AUTONOMY_LEVELS[index].level);
  };

  return (
    <div className="bg-handoff-surface rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-handoff-primary" />
          <span className="text-sm font-medium text-white">Autonomy Level</span>
        </div>
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="relative p-1 text-handoff-muted hover:text-white"
        >
          <Info className="w-4 h-4" />
          {showTooltip && (
            <div className="absolute right-0 top-6 w-48 bg-handoff-dark text-xs text-handoff-muted p-2 rounded-lg shadow-lg z-10">
              Control how often the agent asks for your approval before taking actions.
            </div>
          )}
        </button>
      </div>

      {/* Current level display */}
      <div className={`flex items-center gap-3 mb-4 p-3 rounded-lg bg-handoff-dark/50`}>
        <div className={`w-10 h-10 rounded-full bg-handoff-dark flex items-center justify-center`}>
          <currentConfig.icon className={`w-5 h-5 ${currentConfig.color}`} />
        </div>
        <div>
          <div className={`text-sm font-medium ${currentConfig.color}`}>{currentConfig.label}</div>
          <div className="text-xs text-handoff-muted">{currentConfig.description}</div>
        </div>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          type="range"
          min="0"
          max="2"
          value={currentIndex}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full h-2 bg-handoff-dark rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, 
              #3b82f6 0%, 
              #3b82f6 33%, 
              #eab308 33%, 
              #eab308 66%, 
              #22c55e 66%, 
              #22c55e 100%
            )`,
          }}
        />
        
        {/* Labels */}
        <div className="flex justify-between mt-2">
          {AUTONOMY_LEVELS.map((level, i) => (
            <button
              key={level.level}
              onClick={() => !disabled && onChange(level.level)}
              className={`text-xs transition-colors ${
                i === currentIndex ? level.color : 'text-handoff-muted hover:text-white'
              } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {/* What this means */}
      <div className="mt-4 p-3 bg-handoff-dark/30 rounded-lg">
        <div className="text-xs text-handoff-muted mb-2">What this means:</div>
        <ul className="space-y-1 text-xs">
          {value === 'cautious' && (
            <>
              <li className="flex items-center gap-2 text-blue-300">
                <span className="w-1 h-1 rounded-full bg-blue-400" />
                Every action requires your approval
              </li>
              <li className="flex items-center gap-2 text-blue-300">
                <span className="w-1 h-1 rounded-full bg-blue-400" />
                Maximum control, slower execution
              </li>
            </>
          )}
          {value === 'balanced' && (
            <>
              <li className="flex items-center gap-2 text-yellow-300">
                <span className="w-1 h-1 rounded-full bg-yellow-400" />
                Safe actions proceed automatically
              </li>
              <li className="flex items-center gap-2 text-yellow-300">
                <span className="w-1 h-1 rounded-full bg-yellow-400" />
                Risky or uncertain actions ask first
              </li>
            </>
          )}
          {value === 'autonomous' && (
            <>
              <li className="flex items-center gap-2 text-green-300">
                <span className="w-1 h-1 rounded-full bg-green-400" />
                Most actions proceed automatically
              </li>
              <li className="flex items-center gap-2 text-green-300">
                <span className="w-1 h-1 rounded-full bg-green-400" />
                Only dangerous actions require approval
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

// Compact version for header
export function AutonomyBadge({ level, onClick }: { level: AutonomyLevel; onClick?: () => void }) {
  const config = AUTONOMY_LEVELS.find(l => l.level === level)!;
  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-handoff-dark/50 hover:bg-handoff-dark transition-colors`}
    >
      <Icon className={`w-3.5 h-3.5 ${config.color}`} />
      <span className={`text-xs ${config.color}`}>{config.label}</span>
    </button>
  );
}
