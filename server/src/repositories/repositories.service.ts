import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/prisma/prisma.service'
import { GitHubService, GitHubRepository } from 'src/github/github.service'
import { AnalysisService } from 'src/analysis/analysis.service'
import { AnalysisStatus } from '@prisma/client'
import config from 'src/config'

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GitHubService,
    private readonly analysisService: AnalysisService,
  ) {}

  /**
   * Fetch repositories from GitHub
   */
  async fetchRepositories(organization?: string): Promise<GitHubRepository[]> {
    const orgName = organization || config().keys.github.organization
    
    this.logger.log(`Fetching repositories${orgName ? ` for organization: ${orgName}` : ''}`)
    
    return await this.githubService.getRepositories(orgName || undefined)
  }

  /**
   * Get repositories stored in local database
   */
  async getLocalRepositories() {
    return await this.prisma.repository.findMany({
      include: {
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  /**
   * Save a GitHub repository to local database
   */
  async saveRepository(owner: string, repo: string) {
    this.logger.log(`Saving repository: ${owner}/${repo}`)

    // Fetch repository details from GitHub
    const githubRepo = await this.githubService.getRepository(owner, repo)

    // Check if repository already exists
    const existingRepo = await this.prisma.repository.findUnique({
      where: { githubId: githubRepo.id },
    })

    if (existingRepo) {
      // Update existing repository
      return await this.prisma.repository.update({
        where: { id: existingRepo.id },
        data: {
          name: githubRepo.name,
          fullName: githubRepo.full_name,
          owner: githubRepo.owner.login,
          description: githubRepo.description,
          language: githubRepo.language,
          stars: githubRepo.stargazers_count,
          forks: githubRepo.forks_count,
          isPrivate: githubRepo.private,
          githubUrl: githubRepo.html_url,
          cloneUrl: githubRepo.clone_url,
          defaultBranch: githubRepo.default_branch,
          updatedAt: new Date(),
        },
        include: {
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      })
    }

    // Create new repository
    return await this.prisma.repository.create({
      data: {
        githubId: githubRepo.id,
        name: githubRepo.name,
        fullName: githubRepo.full_name,
        owner: githubRepo.owner.login,
        description: githubRepo.description,
        language: githubRepo.language,
        stars: githubRepo.stargazers_count,
        forks: githubRepo.forks_count,
        isPrivate: githubRepo.private,
        githubUrl: githubRepo.html_url,
        cloneUrl: githubRepo.clone_url,
        defaultBranch: githubRepo.default_branch,
      },
      include: {
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })
  }

  /**
   * Start analysis for a repository
   */
  async startAnalysis(repositoryId: string) {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    })

    if (!repository) {
      throw new NotFoundException('Repository not found')
    }

    this.logger.log(`Starting analysis for repository: ${repository.fullName}`)

    // Check if there's already an analysis in progress
    const existingAnalysis = await this.prisma.analysis.findFirst({
      where: {
        repositoryId,
        status: AnalysisStatus.IN_PROGRESS,
      },
    })

    if (existingAnalysis) {
      return { message: 'Analysis already in progress', analysis: existingAnalysis }
    }

    // Start analysis in background
    this.analysisService.analyzeRepository(repositoryId).catch((error) => {
      this.logger.error(`Analysis failed for repository ${repository.fullName}:`, error)
    })

    return { 
      message: 'Analysis started', 
      repositoryId,
      status: 'IN_PROGRESS' 
    }
  }

  /**
   * Get repository by ID
   */
  async getRepositoryById(repositoryId: string) {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        analyses: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!repository) {
      throw new NotFoundException('Repository not found')
    }

    return repository
  }

  /**
   * Get repository analysis results
   */
  async getRepositoryAnalysis(repositoryId: string) {
    const analysis = await this.prisma.analysis.findFirst({
      where: { 
        repositoryId,
        status: AnalysisStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        repository: true,
      },
    })

    if (!analysis) {
      throw new NotFoundException('No completed analysis found for this repository')
    }

    return analysis
  }

  /**
   * Get analysis status for a repository
   */
  async getAnalysisStatus(repositoryId: string) {
    const analysis = await this.prisma.analysis.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
      },
    })

    if (!analysis) {
      return { status: 'NOT_STARTED', message: 'No analysis found for this repository' }
    }

    return analysis
  }

  /**
   * Get all analyses for a repository
   */
  async getRepositoryAnalyses(repositoryId: string) {
    return await this.prisma.analysis.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        summary: true,
        complexity: true,
        errorMessage: true,
      },
    })
  }

  /**
   * Search repositories by features or technologies
   */
  async searchRepositories(query: string) {
    // Search in repository names, descriptions, and analysis data
    const repositories = await this.prisma.repository.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { fullName: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        analyses: {
          where: { status: AnalysisStatus.COMPLETED },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    // Also search within analysis content
    const analysesWithSearchContent = await this.prisma.analysis.findMany({
      where: {
        status: AnalysisStatus.COMPLETED,
        OR: [
          { summary: { contains: query, mode: 'insensitive' } },
          // For JSON fields, we'd need to implement full-text search or use database-specific features
        ],
      },
      include: {
        repository: true,
      },
    })

    const additionalRepos = analysesWithSearchContent.map(a => ({
      ...a.repository,
      analyses: [a],
    }))

    // Combine and deduplicate results
    const allRepos = [...repositories]
    additionalRepos.forEach(repo => {
      if (!allRepos.find(r => r.id === repo.id)) {
        allRepos.push(repo)
      }
    })

    return allRepos
  }
} 