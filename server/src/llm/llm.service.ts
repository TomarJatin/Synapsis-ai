import { Injectable } from '@nestjs/common'
import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import config from 'src/config'
import { safeParseJson } from 'src/common/utils/parse'
import { LLMRequest, RetryOptions } from './types/llm'
import { ChatCompletionMessageParam } from 'openai/resources/chat'
import { MessageParam } from '@anthropic-ai/sdk/resources/messages'

@Injectable()
export class LLMService {
  private readonly openai: OpenAI
  private readonly openai_gemini: OpenAI
  private readonly openai_perplexity: OpenAI
  private readonly anthropic: Anthropic

  constructor() {
    this.openai = new OpenAI({
      apiKey: config().keys.llm.openai.apiKey,
    })
    this.openai_gemini = new OpenAI({
      apiKey: config().keys.llm.gemini.apiKey,
      baseURL: config().keys.llm.gemini.baseURL,
    })
    this.openai_perplexity = new OpenAI({
      apiKey: config().keys.llm.perplexity.apiKey,
      baseURL: config().keys.llm.perplexity.baseURL,
    })
    this.anthropic = new Anthropic({
      apiKey: config().keys.llm.anthropic.apiKey,
    })
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    options: RetryOptions = { maxAttempts: 3, delayMs: 1000, strategy: 'exponential' },
  ): Promise<T> {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        console.log(`Attempt ${attempt} of ${options.maxAttempts}...`)
        return await operation()
      } catch (error) {
        lastError = error as Error
        if (attempt === options.maxAttempts) break

        const delay = options.strategy === 'exponential' ? Math.pow(2, attempt - 1) * options.delayMs : options.delayMs

        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    if (lastError) {
      throw lastError
    }
    throw new Error('Failed to complete operation')
  }

  public getModel(model: 'openai' | 'gemini' | 'perplexity' | 'anthropic') {
    if (model === 'openai') {
      return this.openai
    }
    if (model === 'gemini') {
      return this.openai_gemini
    }
    if (model === 'perplexity') {
      console.log('perplexity')
      return this.openai_perplexity
    }
    if (model === 'anthropic') {
      return this.anthropic
    }
    throw new Error('Invalid model')
  }

  // Convert OpenAI format messages to Anthropic format
  private convertToAnthropicMessages(messages: ChatCompletionMessageParam[]): MessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'system') {
        // Anthropic handles system messages differently, we'll prepend to first user message
        return null
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      } as MessageParam
    }).filter(Boolean) as MessageParam[]
  }

  // Extract system message from OpenAI format
  private extractSystemMessage(messages: ChatCompletionMessageParam[]): string | undefined {
    const systemMessage = messages.find(msg => msg.role === 'system')
    return systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : JSON.stringify(systemMessage.content)) : undefined
  }

  public async generate<T extends string | object>({
    messages,
    responseFormat = 'string',
    modelConfig,
    options,
  }: LLMRequest) {
    if (modelConfig.model === 'anthropic') {
      const anthropicMessages = this.convertToAnthropicMessages(messages as ChatCompletionMessageParam[])
      const systemMessage = this.extractSystemMessage(messages as ChatCompletionMessageParam[])
      
      const response = await this.retryOperation(
        async () => {
          return await this.anthropic.messages.create({
            model: modelConfig.name,
            max_tokens: 8192,
            system: systemMessage,
            messages: anthropicMessages,
          })
        },
        {
          delayMs: 1000,
          maxAttempts: 3,
          strategy: 'fixed',
        },
      )

      const content = response.content[0]?.type === 'text' ? response.content[0].text : ''
      
      if (responseFormat === 'json') {
        const parsedContent = safeParseJson(content)
        return parsedContent as T
      }
      return content as T
    } else {
      // Handle OpenAI-compatible models
      const model = this.getModel(modelConfig.model)
      const response = await this.retryOperation(
        async () => {
          return await (model as OpenAI).chat.completions.create({
            model: modelConfig.name,
            messages: messages as ChatCompletionMessageParam[],
            response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
            ...options,
          })
        },
        {
          delayMs: 1000,
          maxAttempts: 3,
          strategy: 'fixed',
        },
      )
      if (responseFormat === 'json') {
        const exactResponse = response.choices[0].message.content ?? '{}'
        const parsedContent = safeParseJson(exactResponse)
        return parsedContent as T
      }
      return response?.choices[0]?.message?.content as T
    }
  }
}
