import { 
  Controller, 
  Get, 
  Post, 
  Param, 
  Query, 
  Body, 
  HttpException, 
  HttpStatus,
  Res,
  MessageEvent
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger'
import { RepositoriesService } from './repositories.service'
import { Public } from 'src/auth/decorators/public.decorator'
import { Response } from 'express'

@ApiTags('repositories')
@Controller('repositories')
@Public()
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all repositories from GitHub' })
  @ApiQuery({ name: 'organization', required: false, description: 'GitHub organization name' })
  @ApiResponse({ status: 200, description: 'List of repositories retrieved successfully' })
  async getRepositories(@Query('organization') organization?: string) {
    try {
      return await this.repositoriesService.fetchRepositories(organization)
    } catch (error) {
      throw new HttpException(
        `Failed to fetch repositories: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Get('local')
  @ApiOperation({ summary: 'Get repositories stored locally in database' })
  @ApiResponse({ status: 200, description: 'Local repositories retrieved successfully' })
  async getLocalRepositories() {
    try {
      return await this.repositoriesService.getLocalRepositories()
    } catch (error) {
      throw new HttpException(
        `Failed to fetch local repositories: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Post('save')
  @ApiOperation({ summary: 'Save a repository to local database' })
  @ApiResponse({ status: 201, description: 'Repository saved successfully' })
  async saveRepository(@Body() body: { owner: string; repo: string }) {
    try {
      const { owner, repo } = body
      return await this.repositoriesService.saveRepository(owner, repo)
    } catch (error) {
      throw new HttpException(
        `Failed to save repository: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Post(':id/analyze')
  @ApiOperation({ summary: 'Start analysis of a repository' })
  @ApiResponse({ status: 200, description: 'Analysis started successfully' })
  async analyzeRepository(@Param('id') repositoryId: string) {
    try {
      return await this.repositoriesService.startAnalysis(repositoryId)
    } catch (error) {
      throw new HttpException(
        `Failed to start analysis: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Get(':id/analyze/stream')
  @ApiOperation({ summary: 'Start repository analysis with streaming updates' })
  @ApiResponse({ status: 200, description: 'Analysis started with real-time updates' })
  async analyzeRepositoryStream(@Param('id') repositoryId: string, @Res() response: Response) {
    try {
      // Set SSE headers
      response.setHeader('Content-Type', 'text/event-stream')
      response.setHeader('Cache-Control', 'no-cache')
      response.setHeader('Connection', 'keep-alive')
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', 'Cache-Control')

      // Start analysis with streaming
      await this.repositoriesService.startAnalysisWithStreaming(repositoryId, response)
    } catch (error) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`)
      response.end()
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get repository details by ID' })
  @ApiResponse({ status: 200, description: 'Repository details retrieved successfully' })
  async getRepository(@Param('id') repositoryId: string) {
    try {
      return await this.repositoriesService.getRepositoryById(repositoryId)
    } catch (error) {
      throw new HttpException(
        `Failed to fetch repository: ${error.message}`,
        HttpStatus.NOT_FOUND
      )
    }
  }

  @Get(':id/analysis')
  @ApiOperation({ summary: 'Get repository analysis results' })
  @ApiResponse({ status: 200, description: 'Analysis results retrieved successfully' })
  async getRepositoryAnalysis(@Param('id') repositoryId: string) {
    try {
      return await this.repositoriesService.getRepositoryAnalysis(repositoryId)
    } catch (error) {
      throw new HttpException(
        `Failed to fetch analysis: ${error.message}`,
        HttpStatus.NOT_FOUND
      )
    }
  }

  @Get(':id/analysis/status')
  @ApiOperation({ summary: 'Get repository analysis status' })
  @ApiResponse({ status: 200, description: 'Analysis status retrieved successfully' })
  async getAnalysisStatus(@Param('id') repositoryId: string) {
    try {
      return await this.repositoriesService.getAnalysisStatus(repositoryId)
    } catch (error) {
      throw new HttpException(
        `Failed to fetch analysis status: ${error.message}`,
        HttpStatus.NOT_FOUND
      )
    }
  }
} 