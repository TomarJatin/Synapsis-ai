import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/prisma/prisma.service'
import { LLMService, IntentDetectionResult } from 'src/llm/llm.service'

export interface SearchQuery {
  query: string
  repositoryIds?: string[]
  filters?: {
    languages?: string[]
    frameworks?: string[]
    complexity?: 'low' | 'medium' | 'high'
  }
}

export interface SearchResult {
  repository: {
    id: string
    fullName: string
    description: string | null
  }
  file: {
    path: string
    language: string
    content?: string
  }
  matches: {
    type: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'comment' | 'general'
    name: string
    snippet: string
    lineStart: number
    lineEnd: number
    score: number
    explanation: string
  }[]
  overallScore: number
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  totalFound: number
  searchPatterns?: {
    searchTerms: string[]
    filePatterns: string[]
    codePatterns: string[]
    frameworkHints: string[]
  }
  summary: string
  intentResult: IntentDetectionResult
  responseType: 'code_search' | 'casual_response' | 'help_response'
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LLMService,
  ) {}

  /**
   * Main search method with intent detection
   */
  async searchWithStreaming(
    searchQuery: SearchQuery,
    onProgress: (event: string, data: any) => void
  ): Promise<SearchResponse> {
    const { query } = searchQuery

    this.logger.log(`Starting search with intent detection for: "${query}"`)
    
    onProgress('status', {
      message: 'Analyzing query intent...',
      step: 1,
      totalSteps: 2
    })

    // Step 1: Detect intent
    const intentResult = await this.llmService.detectIntent(query)
    
    onProgress('intent', {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      reasoning: intentResult.reasoning,
      message: `Detected intent: ${intentResult.intent} (${intentResult.confidence}% confidence)`
    })

    // Handle non-code-search intents
    if (intentResult.intent === 'casual_conversation') {
      onProgress('status', {
        message: 'Generating friendly response...',
        step: 2,
        totalSteps: 2
      })

      const casualResponse = intentResult.suggestedResponse || 
        await this.llmService.generateCasualResponse(query)

      return {
        query,
        results: [],
        totalFound: 0,
        summary: casualResponse,
        intentResult,
        responseType: 'casual_response'
      }
    }

    if (intentResult.intent === 'help_request') {
      onProgress('status', {
        message: 'Generating help response...',
        step: 2,
        totalSteps: 2
      })

      const helpResponse = await this.llmService.generateHelpResponse(query)

      return {
        query,
        results: [],
        totalFound: 0,
        summary: helpResponse,
        intentResult,
        responseType: 'help_response'
      }
    }

    // If it's a code search, proceed with the full search pipeline
    return await this.performCodeSearch(searchQuery, onProgress, intentResult)
  }

  /**
   * Perform the actual code search (original logic)
   */
  private async performCodeSearch(
    searchQuery: SearchQuery,
    onProgress: (event: string, data: any) => void,
    intentResult: IntentDetectionResult
  ): Promise<SearchResponse> {
    const { query, repositoryIds, filters } = searchQuery

    onProgress('status', {
      message: 'Analyzing search query...',
      step: 2,
      totalSteps: 7
    })

    // Step 2: Generate search patterns using LLM
    const searchPatterns = await this.llmService.generateSearchPatterns(query, {
      availableLanguages: ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java'],
      availableFrameworks: ['Next.js', 'NestJS', 'React', 'Express', 'FastAPI', 'Django'],
      filters
    })

    onProgress('patterns', {
      patterns: searchPatterns,
      message: `Generated ${searchPatterns.searchTerms.length} search patterns`
    })

    onProgress('status', {
      message: 'Finding relevant repositories...',
      step: 3,
      totalSteps: 7
    })

    // Step 3: Get repositories to search
    const repositories = await this.getSearchableRepositories(repositoryIds, filters)
    
    onProgress('repositories', {
      count: repositories.length,
      repositories: repositories.map(r => ({ id: r.id, fullName: r.fullName })),
      message: `Searching ${repositories.length} repositories`
    })

    onProgress('status', {
      message: 'Searching AST data...',
      step: 4,
      totalSteps: 7
    })

    // Step 4: Search through AST data
    const rawResults = await this.searchASTData(repositories, searchPatterns, query)

    onProgress('raw_results', {
      count: rawResults.length,
      message: `Found ${rawResults.length} potential matches`
    })

    onProgress('status', {
      message: 'Scoring and ranking results...',
      step: 5,
      totalSteps: 7
    })

    // Step 5: Score and rank results using LLM
    const scoredResults = await this.scoreAndRankResults(rawResults, query, searchPatterns)

    onProgress('scored_results', {
      count: scoredResults.length,
      message: `Scored and ranked ${scoredResults.length} results`
    })

    onProgress('status', {
      message: 'Generating summary...',
      step: 6,
      totalSteps: 7
    })

    // Step 6: Generate natural language summary
    const summary = await this.llmService.generateSearchResponse(
      query,
      scoredResults.slice(0, 10), // Top 10 results for summary
      { searchPatterns, totalResults: scoredResults.length, intentResult }
    )

    onProgress('summary', {
      summary,
      message: 'Generated comprehensive summary'
    })

    onProgress('status', {
      message: 'Search completed!',
      step: 7,
      totalSteps: 7
    })

    return {
      query,
      results: scoredResults,
      totalFound: scoredResults.length,
      searchPatterns,
      summary,
      intentResult,
      responseType: 'code_search'
    }
  }

  /**
   * Get repositories that can be searched
   */
  private async getSearchableRepositories(
    repositoryIds?: string[],
    filters?: SearchQuery['filters']
  ) {
    const whereClause: any = {
      analyses: {
        some: {
          status: 'COMPLETED',
          astData: { not: null }
        }
      }
    }

    if (repositoryIds && repositoryIds.length > 0) {
      whereClause.id = { in: repositoryIds }
    }

    if (filters?.languages && filters.languages.length > 0) {
      whereClause.language = { in: filters.languages }
    }

    if (filters?.complexity) {
      whereClause.analyses = {
        some: {
          ...whereClause.analyses.some,
          complexity: filters.complexity
        }
      }
    }

    return await this.prisma.repository.findMany({
      where: whereClause,
      include: {
        analyses: {
          where: { status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            astData: true,
            features: true,
            techStack: true,
            searchableContent: true
          }
        }
      }
    })
  }

  /**
   * Search through AST data using multiple strategies
   */
  private async searchASTData(
    repositories: any[],
    searchPatterns: any,
    originalQuery: string
  ): Promise<any[]> {
    const results: any[] = []

    for (const repo of repositories) {
      const analysis = repo.analyses[0]
      if (!analysis?.astData) continue

      const astData = analysis.astData as any
      
      // Search through each file's AST
      for (const file of astData.files || []) {
        const fileMatches = this.searchFileAST(file, searchPatterns, originalQuery)
        
        if (fileMatches.length > 0) {
          results.push({
            repository: {
              id: repo.id,
              fullName: repo.fullName,
              description: repo.description
            },
            file: {
              path: file.path,
              language: file.language,
              size: file.size
            },
            matches: fileMatches,
            astData: file
          })
        }
      }
    }

    return results
  }

  /**
   * Search within a single file's AST
   */
  private searchFileAST(fileAst: any, searchPatterns: any, originalQuery: string): any[] {
    const matches: any[] = []

    // Search in functions
    if (fileAst.functions) {
      for (const func of fileAst.functions) {
        const score = this.calculateBasicMatchScore(func, searchPatterns, originalQuery)
        if (score > 20) {
          matches.push({
            type: 'function',
            name: func.name || 'anonymous',
            snippet: this.extractFunctionSnippet(func),
            lineStart: func.location?.start?.line || 0,
            lineEnd: func.location?.end?.line || 0,
            score,
            explanation: `Function matches search criteria`,
            data: func
          })
        }
      }
    }

    // Search in classes
    if (fileAst.classes) {
      for (const cls of fileAst.classes) {
        const score = this.calculateBasicMatchScore(cls, searchPatterns, originalQuery)
        if (score > 20) {
          matches.push({
            type: 'class',
            name: cls.name,
            snippet: this.extractClassSnippet(cls),
            lineStart: cls.location?.start?.line || 0,
            lineEnd: cls.location?.end?.line || 0,
            score,
            explanation: `Class matches search criteria`,
            data: cls
          })
        }
      }
    }

    // Search in imports (for framework/library detection)
    if (fileAst.imports) {
      for (const imp of fileAst.imports) {
        const score = this.calculateImportMatchScore(imp, searchPatterns, originalQuery)
        if (score > 30) {
          matches.push({
            type: 'import',
            name: imp.source || 'unknown',
            snippet: `import ... from '${imp.source}'`,
            lineStart: imp.location?.start?.line || 0,
            lineEnd: imp.location?.end?.line || 0,
            score,
            explanation: `Import statement relevant to search`,
            data: imp
          })
        }
      }
    }

    // Search in variables and constants
    if (fileAst.variables) {
      for (const variable of fileAst.variables) {
        const score = this.calculateBasicMatchScore(variable, searchPatterns, originalQuery)
        if (score > 25) {
          matches.push({
            type: 'variable',
            name: variable.name,
            snippet: `${variable.kind} ${variable.name}`,
            lineStart: variable.location?.start?.line || 0,
            lineEnd: variable.location?.end?.line || 0,
            score,
            explanation: `Variable matches search criteria`,
            data: variable
          })
        }
      }
    }

    // Search in comments for documentation
    if (fileAst.comments) {
      for (const comment of fileAst.comments) {
        const score = this.calculateCommentMatchScore(comment, searchPatterns, originalQuery)
        if (score > 15) {
          matches.push({
            type: 'comment',
            name: 'Documentation',
            snippet: comment.value.substring(0, 100) + '...',
            lineStart: comment.location?.start?.line || 0,
            lineEnd: comment.location?.end?.line || 0,
            score,
            explanation: `Comment contains relevant information`,
            data: comment
          })
        }
      }
    }

    return matches.sort((a, b) => b.score - a.score)
  }

  /**
   * Calculate basic match score for AST elements
   */
  private calculateBasicMatchScore(element: any, searchPatterns: any, originalQuery: string): number {
    let score = 0
    
    const elementText = JSON.stringify(element).toLowerCase()
    const queryLower = originalQuery.toLowerCase()
    
    // Direct name match
    if (element.name && element.name.toLowerCase().includes(queryLower)) {
      score += 50
    }

    // Search term matches
    for (const term of searchPatterns.searchTerms || []) {
      if (elementText.includes(term.toLowerCase())) {
        score += 30
      }
    }

    // Code pattern matches
    for (const pattern of searchPatterns.codePatterns || []) {
      if (elementText.includes(pattern.toLowerCase())) {
        score += 25
      }
    }

    // Framework hint matches
    for (const hint of searchPatterns.frameworkHints || []) {
      if (elementText.includes(hint.toLowerCase())) {
        score += 20
      }
    }

    return Math.min(score, 100)
  }

  /**
   * Calculate match score for import statements
   */
  private calculateImportMatchScore(importStatement: any, searchPatterns: any, originalQuery: string): number {
    let score = 0
    
    const source = importStatement.source?.toLowerCase() || ''
    const queryLower = originalQuery.toLowerCase()

    // Direct source match
    if (source.includes(queryLower)) {
      score += 60
    }

    // Framework hints in imports are very relevant
    for (const hint of searchPatterns.frameworkHints || []) {
      if (source.includes(hint.toLowerCase())) {
        score += 40
      }
    }

    // Search terms in import paths
    for (const term of searchPatterns.searchTerms || []) {
      if (source.includes(term.toLowerCase())) {
        score += 35
      }
    }

    return Math.min(score, 100)
  }

  /**
   * Calculate match score for comments
   */
  private calculateCommentMatchScore(comment: any, searchPatterns: any, originalQuery: string): number {
    let score = 0
    
    const commentText = comment.value?.toLowerCase() || ''
    const queryLower = originalQuery.toLowerCase()

    // Direct query match in comments
    if (commentText.includes(queryLower)) {
      score += 40
    }

    // Search terms in comments
    for (const term of searchPatterns.searchTerms || []) {
      if (commentText.includes(term.toLowerCase())) {
        score += 20
      }
    }

    // JSDoc comments are more valuable
    if (comment.isJSDoc) {
      score += 10
    }

    return Math.min(score, 100)
  }

  /**
   * Score and rank results using LLM
   */
  private async scoreAndRankResults(
    rawResults: any[],
    originalQuery: string,
    searchPatterns: any
  ): Promise<SearchResult[]> {
    const scoredResults: SearchResult[] = []

    // Process results in batches to avoid overwhelming the LLM
    const batchSize = 5
    for (let i = 0; i < rawResults.length; i += batchSize) {
      const batch = rawResults.slice(i, i + batchSize)
      
      for (const result of batch) {
        try {
          // Use LLM to calculate more sophisticated match score
          const llmScore = await this.llmService.calculateMatchScore(
            originalQuery,
            {
              file: result.file,
              matches: result.matches,
              repository: result.repository
            },
            { searchPatterns }
          )

          // Combine basic scores with LLM score
          const averageBasicScore = result.matches.reduce((sum: number, match: any) => sum + match.score, 0) / result.matches.length
          const overallScore = (averageBasicScore * 0.3) + (llmScore.score * 0.7)

          scoredResults.push({
            repository: result.repository,
            file: result.file,
            matches: result.matches.map((match: any) => ({
              ...match,
              explanation: llmScore.explanation || match.explanation
            })),
            overallScore
          })
        } catch (error) {
          this.logger.warn(`Failed to score result: ${error.message}`)
          
          // Fallback to basic scoring
          const averageBasicScore = result.matches.reduce((sum: number, match: any) => sum + match.score, 0) / result.matches.length
          
          scoredResults.push({
            repository: result.repository,
            file: result.file,
            matches: result.matches,
            overallScore: averageBasicScore
          })
        }
      }
    }

    // Sort by overall score and return top results
    return scoredResults
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 50) // Limit to top 50 results
  }

  /**
   * Extract meaningful snippets from AST elements
   */
  private extractFunctionSnippet(func: any): string {
    const params = func.params?.map((p: any) => p.name).join(', ') || ''
    const returnType = func.returnType ? `: ${func.returnType}` : ''
    return `${func.name || 'anonymous'}(${params})${returnType}`
  }

  private extractClassSnippet(cls: any): string {
    const extend = cls.superClass ? ` extends ${cls.superClass}` : ''
    const implement = cls.implements?.length > 0 ? ` implements ${cls.implements.join(', ')}` : ''
    return `class ${cls.name}${extend}${implement}`
  }

  /**
   * Simple text-based search for fallback
   */
  async simpleTextSearch(query: string, repositoryIds?: string[]): Promise<SearchResult[]> {
    const repositories = await this.getSearchableRepositories(repositoryIds)
    const results: SearchResult[] = []

    for (const repo of repositories) {
      const analysis = repo.analyses[0]
      if (!analysis?.searchableContent) continue

      const searchableContent = analysis.searchableContent as any
      const queryLower = query.toLowerCase()

      // Search in keywords
      const keywordMatches = searchableContent.keywords?.filter((keyword: string) =>
        keyword.toLowerCase().includes(queryLower)
      ) || []

      // Search in features
      const featureMatches = searchableContent.features?.filter((feature: any) =>
        feature.name.toLowerCase().includes(queryLower) ||
        feature.description.toLowerCase().includes(queryLower)
      ) || []

      if (keywordMatches.length > 0 || featureMatches.length > 0) {
        results.push({
          repository: {
            id: repo.id,
            fullName: repo.fullName,
            description: repo.description
          },
          file: {
            path: 'repository-level',
            language: 'metadata'
          },
          matches: [
            ...keywordMatches.map((keyword: string) => ({
              type: 'general' as const,
              name: keyword,
              snippet: `Keyword: ${keyword}`,
              lineStart: 0,
              lineEnd: 0,
              score: 30,
              explanation: 'Keyword match'
            })),
            ...featureMatches.map((feature: any) => ({
              type: 'general' as const,
              name: feature.name,
              snippet: feature.description,
              lineStart: 0,
              lineEnd: 0,
              score: 40,
              explanation: 'Feature match'
            }))
          ],
          overallScore: 35
        })
      }
    }

    return results.sort((a, b) => b.overallScore - a.overallScore)
  }
} 