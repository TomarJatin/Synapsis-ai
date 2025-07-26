import { CoreMessage } from 'ai'

export type LLMModel = 'gemini' | 'anthropic'

export type RetryOptions = {
  maxAttempts: number
  delayMs: number
  strategy: 'fixed' | 'exponential'
}

export type LLMModelConfig = 
  | {
      model: 'openai' | 'gemini' | 'perplexity'
      name: string
    }
  | {
      model: 'anthropic'
      name: string
    }

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LLMRequest = {
  messages: LLMMessage[]
  responseFormat?: 'string' | 'json'
  modelConfig: LLMModelConfig
  options?: Record<string, any>
}
