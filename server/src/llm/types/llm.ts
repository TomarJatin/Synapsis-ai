import { ChatCompletionMessageParam } from 'openai/resources/chat'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat'
import { MessageParam } from '@anthropic-ai/sdk/resources/messages'

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

export type LLMRequest = {
  messages: ChatCompletionMessageParam[] | MessageParam[]
  responseFormat?: 'string' | 'json'
  modelConfig: LLMModelConfig
  options?: Partial<ChatCompletionCreateParamsNonStreaming>
}
