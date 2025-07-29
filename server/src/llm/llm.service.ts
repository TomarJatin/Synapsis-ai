import { Injectable, Logger } from '@nestjs/common'
import { generateObject, generateText, streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import config from 'src/config'

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMModelConfig {
  model: 'anthropic' | 'openai'
  name: string
  temperature?: number
  maxTokens?: number
}

export interface LLMGenerateOptions<T = any> {
  messages: LLMMessage[]
  responseFormat: 'string' | 'json'
  modelConfig: LLMModelConfig
  schema?: z.ZodSchema<T>
  maxRetries?: number
}

export interface LLMStreamOptions {
  messages: LLMMessage[]
  modelConfig: LLMModelConfig
  onToken?: (token: string) => void
  onComplete?: (fullText: string) => void
  onError?: (error: Error) => void
}

export interface IntentDetectionResult {
  intent: 'code_search' | 'casual_conversation' | 'help_request'
  confidence: number
  reasoning: string
  suggestedResponse?: string
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name)

  constructor() {
    // Verify API keys are configured
    if (!config().keys.llm?.anthropic?.apiKey && !config().keys.llm?.openai?.apiKey) {
      this.logger.warn('No AI API keys configured. LLM functionality will be limited.')
    }
  }

  /**
   * Get the appropriate model instance based on configuration
   */
  private getModel(modelConfig: LLMModelConfig) {
    const { model, name } = modelConfig

    switch (model) {
      case 'anthropic':
        if (!config().keys.llm?.anthropic?.apiKey) {
          throw new Error('Anthropic API key not configured')
        }
        // Set the API key as environment variable for the SDK
        process.env.ANTHROPIC_API_KEY = config().keys.llm.anthropic.apiKey
        return anthropic(name)

      case 'openai':
        if (!config().keys.llm?.openai?.apiKey) {
          throw new Error('OpenAI API key not configured')
        }
        // Set the API key as environment variable for the SDK
        process.env.OPENAI_API_KEY = config().keys.llm.openai.apiKey
        return openai(name)

      default:
        throw new Error(`Unsupported model provider: ${model}`)
    }
  }

  /**
   * Generate text or structured objects using LLM with retry logic
   */
  async generate<T = string>(options: LLMGenerateOptions<T>): Promise<T> {
    const { messages, responseFormat, modelConfig, schema, maxRetries = 3 } = options
    
    let attempt = 0
    while (attempt < maxRetries) {
      try {
        const model = this.getModel(modelConfig)
        
        if (responseFormat === 'json' && schema) {
          const result = await generateObject({
            model,
            messages: messages.map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            schema,
            temperature: modelConfig.temperature || 0.7,
            maxTokens: modelConfig.maxTokens || 4000,
          })
          
          return result.object as T
        } else {
          const result = await generateText({
            model,
            messages: messages.map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            temperature: modelConfig.temperature || 0.7,
            maxTokens: modelConfig.maxTokens || 4000,
          })
          
          return result.text as T
        }
      } catch (error) {
        attempt++
        this.logger.warn(`LLM generation failed (attempt ${attempt}/${maxRetries}): ${error.message}`)
        
        if (attempt >= maxRetries) {
          throw new Error(`LLM generation failed after ${maxRetries} attempts: ${error.message}`)
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }
    
    throw new Error('LLM generation failed: Maximum retries exceeded')
  }

  /**
   * Stream text generation with real-time updates
   */
  async streamGeneration(options: LLMStreamOptions): Promise<void> {
    const { messages, modelConfig, onToken, onComplete, onError } = options

    try {
      const model = this.getModel(modelConfig)
      
      const result = await streamText({
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: modelConfig.temperature || 0.7,
        maxTokens: modelConfig.maxTokens || 4000,
      })

      let fullText = ''
      
      for await (const textPart of result.textStream) {
        fullText += textPart
        if (onToken) {
          onToken(textPart)
        }
      }
      
      if (onComplete) {
        onComplete(fullText)
      }
    } catch (error) {
      this.logger.error(`LLM streaming failed: ${error.message}`)
      if (onError) {
        onError(error)
      }
      throw error
    }
  }

  /**
   * Detect the intent of a user query
   */
  async detectIntent(query: string): Promise<IntentDetectionResult> {
    const schema = z.object({
      intent: z.enum(['code_search', 'casual_conversation', 'help_request']).describe('The primary intent of the query'),
      confidence: z.number().min(0).max(100).describe('Confidence level from 0-100'),
      reasoning: z.string().describe('Brief explanation of why this intent was chosen'),
      suggestedResponse: z.string().optional().describe('For casual conversation, a friendly response to the user')
    })

    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are an intent detection system for a code search assistant. Analyze user queries and determine their intent.

INTENT CATEGORIES:
1. code_search: User wants to find code, implementations, patterns, or technical information in repositories
   - Examples: "find authentication", "show me NextAuth setup", "how is login implemented", "find React components"
   
2. casual_conversation: General greetings, thanks, or casual chat not related to code search
   - Examples: "hi", "hello", "thanks", "thank you", "how are you", "good morning"
   
3. help_request: User needs help understanding how to use the system or wants guidance
   - Examples: "how do I search", "what can you do", "help me", "how does this work"

GUIDELINES:
- Be confident in your assessment (confidence > 80 for clear cases)
- For ambiguous cases, default to code_search if there's any technical context
- For casual_conversation, provide a brief, friendly response in suggestedResponse
- For help_request, explain briefly what the system can do`
        },
        {
          role: 'user',
          content: query
        }
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-haiku-20240307',
        temperature: 0.3,
        maxTokens: 500
      },
      schema
    })

    this.logger.log(`Intent detected for "${query}": ${result.intent} (${result.confidence}% confidence)`)
    
    return result
  }

  /**
   * Generate a casual conversation response
   */
  async generateCasualResponse(query: string, context?: string): Promise<string> {
    const contextPrompt = context ? `\n\nContext: ${context}` : ''
    
    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are a friendly code search assistant. Respond warmly and briefly to casual conversation.
Keep responses short (1-2 sentences) and always mention that you're here to help with code search if they need it.
Be professional but friendly.${contextPrompt}`
        },
        {
          role: 'user',
          content: query
        }
      ],
      responseFormat: 'string',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-haiku-20240307',
        temperature: 0.7,
        maxTokens: 200
      }
    })

    return result
  }

  /**
   * Generate a help response
   */
  async generateHelpResponse(query: string): Promise<string> {
    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are a helpful code search assistant. Explain what you can do and how to use the system.
Be concise but informative. Mention that you can search through analyzed repositories for code patterns, implementations, and more.
Give 2-3 example queries they could try.`
        },
        {
          role: 'user',
          content: query
        }
      ],
      responseFormat: 'string',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-haiku-20240307',
        temperature: 0.7,
        maxTokens: 400
      }
    })

    return result
  }

  /**
   * Generate search patterns for agentic search
   */
  async generateSearchPatterns(query: string, context: any): Promise<{
    searchTerms: string[]
    filePatterns: string[]
    codePatterns: string[]
    frameworkHints: string[]
  }> {
    const schema = z.object({
      searchTerms: z.array(z.string()).describe('Key terms to search for in code'),
      filePatterns: z.array(z.string()).describe('File path patterns that might contain relevant code'),
      codePatterns: z.array(z.string()).describe('Code patterns, function names, or class names to look for'),
      frameworkHints: z.array(z.string()).describe('Framework or library specific patterns')
    })

    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are an expert code search assistant. Given a user query, generate comprehensive search patterns to find relevant code implementations across multiple programming languages and frameworks.`
        },
        {
          role: 'user',
          content: `User query: "${query}"
          
Available context: ${JSON.stringify(context, null, 2)}

Generate search patterns that will help find code implementations related to this query. Consider:
- Multiple programming languages (JavaScript, TypeScript, Python, Go, Rust, Java, etc.)
- Various frameworks and libraries
- Different naming conventions
- File organization patterns
- Code structure patterns`
        }
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
        temperature: 0.3
      },
      schema
    })

    return result
  }

  /**
   * Calculate match score for search results
   */
  async calculateMatchScore(
    query: string,
    codeSnippet: any,
    context: any
  ): Promise<{ score: number; explanation: string; relevantParts: string[] }> {
    const schema = z.object({
      score: z.number().min(0).max(100).describe('Match score from 0-100'),
      explanation: z.string().describe('Explanation of why this code matches the query'),
      relevantParts: z.array(z.string()).describe('Specific parts of the code that are most relevant')
    })

    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are an expert code analysis assistant. Analyze how well a code snippet matches a user's search query and provide a detailed score and explanation.`
        },
        {
          role: 'user',
          content: `User query: "${query}"

Code snippet:
${JSON.stringify(codeSnippet, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Analyze this code snippet and determine how well it matches the user's query. Consider:
- Direct implementation of the requested feature
- Related functionality
- Configuration or setup code
- Documentation or comments
- File location and naming
- Framework/library usage patterns

Provide a score from 0-100 where:
- 90-100: Direct implementation of the requested feature
- 70-89: Closely related implementation
- 50-69: Partially related code
- 30-49: Tangentially related
- 0-29: Not really related`
        }
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
        temperature: 0.2
      },
      schema
    })

    return result
  }

  /**
   * Generate natural language response for search results
   */
  async generateSearchResponse(
    query: string,
    searchResults: any[],
    context: any
  ): Promise<string> {
    const result = await this.generate({
      messages: [
        {
          role: 'system',
          content: `You are a helpful code assistant. Based on search results from code repositories, provide a comprehensive and helpful response to the user's query. Include specific code examples, file locations, and implementation details when relevant.`
        },
        {
          role: 'user',
          content: `User query: "${query}"

Search results:
${JSON.stringify(searchResults, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Provide a helpful response that:
1. Directly answers the user's question
2. Shows relevant code examples with file locations
3. Explains how the implementations work
4. Suggests related patterns or alternatives if applicable
5. Uses markdown formatting for code blocks and structure

Be specific and technical, but also clear and helpful.`
        }
      ],
      responseFormat: 'string',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
        temperature: 0.4
      }
    })

    return result
  }

  /**
   * Test AI connectivity and configuration
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.generate({
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Say "Hello, I am working correctly!"' }
        ],
        responseFormat: 'string',
        modelConfig: {
          model: 'anthropic',
          name: 'claude-3-5-sonnet-20241022',
          temperature: 0
        }
      })

      return {
        success: true,
        message: `AI connection successful: ${result}`
      }
    } catch (error) {
      return {
        success: false,
        message: `AI connection failed: ${error.message}`
      }
    }
  }

  /**
   * Generate a casual conversation response with streaming
   */
  async generateCasualResponseStreaming(
    query: string, 
    context?: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const contextPrompt = context ? `\n\nContext: ${context}` : ''
    
    try {
      const model = this.getModel({
        model: 'anthropic',
        name: 'claude-3-haiku-20240307',
        temperature: 0.7,
        maxTokens: 200
      })
      
      const result = await streamText({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a friendly code search assistant. Respond warmly and briefly to casual conversation.
Keep responses short (1-2 sentences) and always mention that you're here to help with code search if they need it.
Be professional but friendly.${contextPrompt}`
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.7,
        maxTokens: 200,
      })

      let fullText = ''
      
      for await (const textPart of result.textStream) {
        fullText += textPart
        if (onToken) {
          onToken(textPart)
        }
      }
      
      return fullText
    } catch (error) {
      this.logger.error(`Casual response streaming failed: ${error.message}`)
      // Fallback to non-streaming
      return await this.generateCasualResponse(query, context)
    }
  }

  /**
   * Generate a help response with streaming
   */
  async generateHelpResponseStreaming(
    query: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    try {
      const model = this.getModel({
        model: 'anthropic',
        name: 'claude-3-haiku-20240307',
        temperature: 0.7,
        maxTokens: 400
      })
      
      const result = await streamText({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a helpful code search assistant. Explain what you can do and how to use the system.
Be concise but informative. Mention that you can search through analyzed repositories for code patterns, implementations, and more.
Give 2-3 example queries they could try.`
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.7,
        maxTokens: 400,
      })

      let fullText = ''
      
      for await (const textPart of result.textStream) {
        fullText += textPart
        if (onToken) {
          onToken(textPart)
        }
      }
      
      return fullText
    } catch (error) {
      this.logger.error(`Help response streaming failed: ${error.message}`)
      // Fallback to non-streaming
      return await this.generateHelpResponse(query)
    }
  }
}
