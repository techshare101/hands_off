// Agent module exports
export { AgentCore } from './agentCore';
export type { AgentConfig, AgentStepEvent } from './agentCore';

export { GeminiClient, getGeminiClient } from './geminiClient';
export type { AnalysisRequest, AnalysisResult } from './geminiClient';

export { AgentStateMachine } from './stateMachine';
export type { AgentState, AgentEvent, ProposedAction, AgentContext } from './stateMachine';

export { ToolRegistry, createDefaultTools } from './tools';
export type { Tool, ToolResult } from './tools';

export { evaluateApproval, checkUsageLimits, FREE_TIER_LIMITS, PRO_TIER_LIMITS } from './approvalGates';
export type { ApprovalLevel, ApprovalRule, ApprovalContext, UsageLimits, UsageTracker } from './approvalGates';

export { 
  COMPUTER_USE_SYSTEM_PROMPT, 
  FORM_FILLER_PROMPT, 
  WEB_RESEARCH_PROMPT, 
  WORKSPACE_CLEANUP_PROMPT,
  getPromptForTask,
  validateGeminiResponse 
} from './prompts';
export type { ActionSchema, GeminiResponse } from './prompts';

export { ExpertReviewEngine, expertReview } from './expertReview';
export type { RiskAssessment, FailurePrediction, ExpertWarning, ChallengeResult } from './expertReview';

export { GracefulDegradationManager, gracefulDegradation } from './gracefulDegradation';
export type { TaskProgress, CompletedStep, FailedStep, RecoveryOption } from './gracefulDegradation';

export { workflowMemory } from './workflowMemory';
export type { SavedWorkflow, WorkflowStep } from './workflowMemory';

export { usageTracker } from './usageTracker';
export type { UsageData } from './usageTracker';

// Self-Learning Engine
export { executionMemory } from './executionMemory';
export type { ExecutionTrace, TracedAction, LearnedPattern, FailureCategory } from './executionMemory';

export { failureLearning } from './failureLearning';
export type { FailureAnalysis, FixStrategy, FailureContext } from './failureLearning';

export { autoSkill } from './autoSkill';
export type { Skill, SkillStep, SkillMatch, SkillMetadata, SkillExecutionResult } from './autoSkill';

export { hybridBrain } from './hybridBrain';
export type { ExecutionMode, ModeDecision, ExecutionContext } from './hybridBrain';

export { ArkVisionClient, getArkClient } from './arkClient';

export { HFInferenceClient, getHFClient, HF_MODELS } from './hfClient';
export type { HFConfig, DetectedObject, BoundingBox, OCRWord, EmbeddingResult, ClassificationResult } from './hfClient';

export { hfVision } from './hfVision';
export type { UIElement, PageAnalysis } from './hfVision';

export { molmoVision } from './molmoVision';
export type { GroundingResult, MolmoConfig } from './molmoVision';

export { hfEmbeddings } from './hfEmbeddings';
export type { SemanticMatch } from './hfEmbeddings';

export { OpenAICompatClient, OpenAIClient, GroqClient, DeepSeekClient, QwenClient, MistralClient } from './openAICompatClient';
export { OPENAI_MODELS, GROQ_MODELS, DEEPSEEK_MODELS, QWEN_MODELS, MISTRAL_MODELS } from './openAICompatClient';
export { AnthropicClient, ANTHROPIC_MODELS } from './anthropicClient';

export { metaAgent } from './metaAgent';
export type { PromptPatch, OptimizationExperiment, SiteStrategy, MetaAgentStats, TaskTemplate, TaskScore, VerificationRule } from './metaAgent';

// Tool Modules
export { apiTool } from './apiTool';
export type { ApiToolConfig, ApiRequest, ApiResponse, ApiLogEntry, SavedEndpoint, HttpMethod } from './apiTool';

export { skillRecorder, BUILT_IN_TEMPLATES } from './skillRecorder';
export type { RecordingSession, RecordedStep, SkillVariable, SkillTemplate, SkillCategory } from './skillRecorder';

export { fileTool, composeJSON, composeCSV, composeHTML, composeMarkdown, composeCodeFile } from './fileTool';
export type { FileGenerateRequest, FileDownloadRequest, FileResult, FileLogEntry } from './fileTool';

export { mcpServer } from './mcpServer';
export type { MCPServerConfig, MCPRequest, MCPResponse, MCPToolDefinition, MCPResource } from './mcpServer';
