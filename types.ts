// 定义工具相关接口
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchemaJSON: string;
  toolSafety: number;
}

export interface ToolUse {
  toolUseID: string;
  toolName: string;
  inputJSON: string;
}

export interface AgentMemory {
  content: string;
}

export interface Node {
  id: number;
  type: number;
  content: string;
  toolUse: ToolUse;
  agentMemory: AgentMemory;
}

// 修改 AugmentChatHistory 接口
export interface AugmentChatHistory {
  responseText: string;
  requestMessage: string;
  requestID?: string;
  requestNodes?: Node[];
  responseNodes?: Node[];
}

// 修改 AugmentRequest 接口
export interface AugmentRequest {
  chatHistory: AugmentChatHistory[];
  message: string;
  mode: string;
  prefix?: string;
  suffix?: string;
  lang?: string;
  path?: string;
  blobs?: {
    checkpointID: string;
    addedBlobs: [];
    deletedBlobs: [];
  };
  userGuidedBlobs?: [];
  externalSourceIds?: [];
  featureDetectionFlags?: {
    supportRawOutput: boolean;
  };
  toolDefinitions?: ToolDefinition[];
  nodes?: Node[];
}

// 模型接口定义
export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: string;
  data: OpenAIModel[];
}


export interface TokenData {
  token: string;
  tenant_url: string;
  created_at: number;
}

// 定义接口
export interface OpenAIRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
}

export interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

export interface StreamChoice {
  index: number;
  delta: ChatMessage;
  finish_reason: string | null;
}

export interface Choice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatMessage {
  role: string;
  content: any;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AugmentRequest {
  chatHistory: AugmentChatHistory[];
  message: string;
  mode: string;
}

export interface AugmentChatHistory {
  responseText: string;
  requestMessage: string;
}

export interface AugmentResponse {
  text: string;
  done: boolean;
}



