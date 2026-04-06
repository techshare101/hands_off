// Component exports for HandOff side panel

// Core UI
export { default as Header } from './Header';
export { default as TaskInput } from './TaskInput';
export { default as ActionFeed } from './ActionFeed';
export { default as Controls } from './Controls';
export { default as Settings } from './Settings';

// Trust & Transparency (Tier 1)
export { default as ExecutionTimeline } from './ExecutionTimeline';
export { default as InlineCorrection } from './InlineCorrection';
export type { CorrectionPayload } from './InlineCorrection';
export { default as StepRationale, RationaleInline } from './StepRationale';
export { default as SmartSafetyPrompt } from './SmartSafetyPrompt';
export { default as ApprovalModal } from './ApprovalModal';

// Cost & Usage
export { default as CostDashboard, useCostTracker } from './CostDashboard';
export { default as UsageMeter } from './UsageMeter';

// Control & Autonomy
export { default as ConfidenceSlider, AutonomyBadge, getApprovalThreshold } from './ConfidenceSlider';
export type { AutonomyLevel } from './ConfidenceSlider';

// Feedback & Correction
export { default as CorrectionInput } from './CorrectionInput';
export { default as UncertaintyPrompt } from './UncertaintyPrompt';

// Onboarding
export { default as ApiKeyPrompt } from './ApiKeyPrompt';

// Expert Review (Agent challenges unsafe workflows)
export { default as ExpertReviewPanel } from './ExpertReviewPanel';
export { default as AgentChallenge } from './AgentChallenge';
export { default as WorkflowPicker } from './WorkflowPicker';

// Self-Learning Engine
export { default as LearningPanel } from './LearningPanel';
