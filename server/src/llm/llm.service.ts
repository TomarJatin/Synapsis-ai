import { Injectable } from '@nestjs/common'
import { generateObject, generateText, zodSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import config from 'src/config'
import { LLMRequest, RetryOptions } from './types/llm'
import { z } from 'zod'

@Injectable()
export class LLMService {
  private readonly openaiProvider
  private readonly anthropicProvider
  private readonly geminiProvider
  private readonly perplexityProvider

  constructor() {
    this.openaiProvider = createOpenAI({
      apiKey: config().keys.llm.openai.apiKey,
    })
    
    this.anthropicProvider = createAnthropic({
      apiKey: config().keys.llm.anthropic.apiKey,
    })
    
    this.geminiProvider = createOpenAI({
      apiKey: config().keys.llm.gemini.apiKey,
      baseURL: config().keys.llm.gemini.baseURL,
    })
    
    this.perplexityProvider = createOpenAI({
      apiKey: config().keys.llm.perplexity.apiKey,
      baseURL: config().keys.llm.perplexity.baseURL,
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

  private getModelInstance(model: 'openai' | 'gemini' | 'perplexity' | 'anthropic', modelName: string) {
    if (model === 'anthropic') {
      return this.anthropicProvider(modelName)
    } else if (model === 'openai') {
      return this.openaiProvider(modelName)
    } else if (model === 'gemini') {
      return this.geminiProvider(modelName)
    } else if (model === 'perplexity') {
      return this.perplexityProvider(modelName)
    }
    throw new Error('Invalid model')
  }

  public async generate<T extends string | object>({
    messages,
    responseFormat = 'string',
    modelConfig,
    options,
    schema,
  }: LLMRequest & { schema?: z.ZodSchema<any> }) {
    const model = this.getModelInstance(modelConfig.model, modelConfig.name)

    // Convert messages to CoreMessage format
    const convertedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))

    return await this.retryOperation(
      async () => {
        if (responseFormat === 'json' && schema) {
          const result = await generateObject({
            model,
            messages: convertedMessages,
            schema: zodSchema(schema),
            mode: 'tool',
            ...options,
          })
          return result.object as T
        } else {
          const result = await generateText({
            model,
            messages: convertedMessages,
            ...options,
          })
          return result.text as T
        }
      },
      {
        delayMs: 1000,
        maxAttempts: 3,
        strategy: 'fixed',
      },
    )
  }

  // Helper method for streaming text generation (will be used for SSE)
  public async generateStream({
    messages,
    modelConfig,
    options,
  }: Omit<LLMRequest, 'responseFormat'>) {
    const model = this.getModelInstance(modelConfig.model, modelConfig.name)

    const convertedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))

    return generateText({
      model,
      messages: convertedMessages,
      ...options,
    })
  }
}
