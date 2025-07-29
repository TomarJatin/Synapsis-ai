import { Controller, Get, Post, Body, Query, Res, Logger, Param } from '@nestjs/common'
import { SearchService, SearchQuery } from './search.service'
import { Public } from 'src/auth/decorators/public.decorator'
import { Response } from 'express'

export interface SearchRequestDto {
  query: string
  repositoryIds?: string[]
  filters?: {
    languages?: string[]
    frameworks?: string[]
    complexity?: 'low' | 'medium' | 'high'
  }
}

@Controller('search')
@Public()
export class SearchController {
  private readonly logger = new Logger(SearchController.name)

  constructor(private readonly searchService: SearchService) {}

  /**
   * Stream search results with real-time updates via Server-Sent Events (GET)
   */
  @Get('stream')
  async streamSearchGet(
    @Query('query') query: string,
    @Res() response: Response,
    @Query('repositoryIds') repositoryIds?: string,
    @Query('languages') languages?: string,
    @Query('frameworks') frameworks?: string,
    @Query('complexity') complexity?: 'low' | 'medium' | 'high'
  ) {
    if (!query) {
      response.status(400).json({ error: 'Query parameter is required' })
      return
    }

    this.logger.log(`Starting streaming search for: "${query}"`)

    // Set up Server-Sent Events headers
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Content-Type')

    try {
      // Send initial connection confirmation
      response.write(`event: connected\ndata: ${JSON.stringify({ 
        message: 'Search stream connected',
        query
      })}\n\n`)

      // Parse filters
      const filters: any = {}
      if (languages) filters.languages = languages.split(',')
      if (frameworks) filters.frameworks = frameworks.split(',')
      if (complexity) filters.complexity = complexity

      const searchRequest: SearchQuery = {
        query,
        repositoryIds: repositoryIds ? repositoryIds.split(',') : undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined
      }

      // Perform the search with streaming callbacks
      const results = await this.searchService.searchWithStreaming(
        searchRequest,
        (event: string, data: any) => {
          // Send each update as an SSE event
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }
      )

      // Send final results
      response.write(`event: results\ndata: ${JSON.stringify(results)}\n\n`)

      // Send completion event
      response.write(`event: complete\ndata: ${JSON.stringify({ 
        message: 'Search completed successfully',
        totalResults: results.totalFound
      })}\n\n`)

    } catch (error) {
      this.logger.error(`Streaming search failed: ${error.message}`)
      
      response.write(`event: error\ndata: ${JSON.stringify({ 
        error: error.message,
        query
      })}\n\n`)
    } finally {
      response.end()
    }
  }

  /**
   * Stream search results with real-time updates via Server-Sent Events (POST)
   */
  @Post('stream')
  async streamSearch(
    @Body() searchRequest: SearchRequestDto,
    @Res() response: Response
  ) {
    this.logger.log(`Starting streaming search for: "${searchRequest.query}"`)

    // Set up Server-Sent Events headers
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Content-Type')

    try {
      // Send initial connection confirmation
      response.write(`event: connected\ndata: ${JSON.stringify({ 
        message: 'Search stream connected',
        query: searchRequest.query
      })}\n\n`)

      // Perform the search with streaming callbacks
      const results = await this.searchService.searchWithStreaming(
        searchRequest as SearchQuery,
        (event: string, data: any) => {
          // Send each update as an SSE event
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }
      )

      // Send final results
      response.write(`event: results\ndata: ${JSON.stringify(results)}\n\n`)

      // Send completion event
      response.write(`event: complete\ndata: ${JSON.stringify({ 
        message: 'Search completed successfully',
        totalResults: results.totalFound
      })}\n\n`)

    } catch (error) {
      this.logger.error(`Streaming search failed: ${error.message}`)
      
      response.write(`event: error\ndata: ${JSON.stringify({ 
        error: error.message,
        query: searchRequest.query
      })}\n\n`)
    } finally {
      response.end()
    }
  }

  /**
   * Regular search endpoint without streaming
   */
  @Post()
  async search(@Body() searchRequest: SearchRequestDto) {
    this.logger.log(`Performing search for: "${searchRequest.query}"`)

    try {
      const results = await this.searchService.searchWithStreaming(
        searchRequest as SearchQuery,
        () => {} // No-op callback for non-streaming search
      )

      return {
        success: true,
        data: results
      }
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`)
      
      return {
        success: false,
        error: error.message,
        query: searchRequest.query
      }
    }
  }

  /**
   * Simple text-based search for quick queries
   */
  @Get('simple')
  async simpleSearch(
    @Query('q') query: string,
    @Query('repositories') repositoryIds?: string
  ) {
    if (!query) {
      return {
        success: false,
        error: 'Query parameter is required'
      }
    }

    try {
      const repoIds = repositoryIds ? repositoryIds.split(',') : undefined
      const results = await this.searchService.simpleTextSearch(query, repoIds)

      return {
        success: true,
        data: {
          query,
          results,
          totalFound: results.length
        }
      }
    } catch (error) {
      this.logger.error(`Simple search failed: ${error.message}`)
      
      return {
        success: false,
        error: error.message,
        query
      }
    }
  }

  /**
   * Test search connectivity and configuration
   */
  @Get('test')
  async testSearch() {
    try {
      // Test with a simple query
      const testResults = await this.searchService.simpleTextSearch('test')
      
      return {
        success: true,
        message: 'Search service is working correctly',
        testResultsCount: testResults.length
      }
    } catch (error) {
      this.logger.error(`Search test failed: ${error.message}`)
      
      return {
        success: false,
        error: error.message,
        message: 'Search service test failed'
      }
    }
  }

  /**
   * Get search suggestions based on available repositories
   */
  @Get('suggestions')
  async getSearchSuggestions(
    @Query('q') query?: string,
    @Query('limit') limit?: string
  ) {
    try {
      // This would ideally use a more sophisticated suggestion algorithm
      // For now, return some common search patterns
      const suggestions = [
        'authentication implementation',
        'API endpoints',
        'database operations',
        'React components',
        'Next.js configuration',
        'TypeScript interfaces',
        'error handling',
        'validation schemas',
        'middleware functions',
        'testing setup'
      ]

      const filteredSuggestions = query 
        ? suggestions.filter(s => s.toLowerCase().includes(query.toLowerCase()))
        : suggestions

      const limitNum = limit ? parseInt(limit, 10) : 10
      
      return {
        success: true,
        data: {
          suggestions: filteredSuggestions.slice(0, limitNum),
          query: query || ''
        }
      }
    } catch (error) {
      this.logger.error(`Failed to get search suggestions: ${error.message}`)
      
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get search filters based on available repositories
   */
  @Get('filters')
  async getSearchFilters() {
    try {
      // This would query the database for available filters
      // For now, return static filters based on supported languages/frameworks
      const filters = {
        languages: [
          'TypeScript',
          'JavaScript', 
          'Python',
          'Go',
          'Rust',
          'Java',
          'C++',
          'C#',
          'Ruby',
          'PHP',
          'Swift',
          'Kotlin'
        ],
        frameworks: [
          'Next.js',
          'React',
          'NestJS',
          'Express',
          'FastAPI',
          'Django',
          'Spring Boot',
          'Gin',
          'Rails',
          'Laravel'
        ],
        complexity: ['low', 'medium', 'high']
      }

      return {
        success: true,
        data: filters
      }
    } catch (error) {
      this.logger.error(`Failed to get search filters: ${error.message}`)
      
      return {
        success: false,
        error: error.message
      }
    }
  }
} 