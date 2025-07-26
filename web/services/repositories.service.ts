import { ApiClient } from '@/lib/api-client'

export interface Repository {
  id: string
  githubId: number
  name: string
  fullName: string
  owner: string
  description?: string
  language?: string
  stars: number
  forks: number
  isPrivate: boolean
  githubUrl: string
  cloneUrl: string
  defaultBranch: string
  createdAt: string
  updatedAt: string
  lastAnalyzed?: string
  analyses?: Analysis[]
}

export interface Analysis {
  id: string
  repositoryId: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  startedAt: string
  completedAt?: string
  errorMessage?: string
  features?: RepositoryFeature[]
  structure?: RepositoryStructure
  dependencies?: Record<string, number>
  documentation?: { readme?: string }
  codeMetrics?: CodeMetrics
  astData?: any
  searchableContent?: any
  summary?: string
  techStack?: TechStack
  complexity?: 'low' | 'medium' | 'high'
}

export interface RepositoryFeature {
  name: string
  description: string
  files: string[]
  type: 'authentication' | 'api' | 'database' | 'ui' | 'testing' | 'deployment' | 'other'
  implementation: string
  dependencies: string[]
}

export interface RepositoryStructure {
  architecture: string
  patterns: string[]
  directories: {
    path: string
    purpose: string
    importance: number
  }[]
  entryPoints: string[]
  configFiles: string[]
}

export interface CodeMetrics {
  totalFiles: number
  linesOfCode: number
  complexity: 'low' | 'medium' | 'high'
  maintainability: number
  testCoverage?: number
}

export interface TechStack {
  frontend?: string[]
  backend?: string[]
  database?: string[]
  tools?: string[]
  frameworks?: string[]
  languages: string[]
}

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
  }
  description?: string
  language?: string
  stargazers_count: number
  forks_count: number
  private: boolean
  html_url: string
  clone_url: string
  default_branch: string
}

export class RepositoriesService {
  /**
   * Fetch repositories from GitHub
   */
  static async getGitHubRepositories(organization?: string) {
    const params = organization ? { organization } : {}
    return await ApiClient.get<GitHubRepository[]>('/repositories', { params })
  }

  /**
   * Get repositories stored locally
   */
  static async getLocalRepositories() {
    return await ApiClient.get<Repository[]>('/repositories/local')
  }

  /**
   * Save a repository to local database
   */
  static async saveRepository(owner: string, repo: string) {
    return await ApiClient.post<Repository>('/repositories/save', { owner, repo })
  }

  /**
   * Start analysis of a repository
   */
  static async analyzeRepository(repositoryId: string) {
    return await ApiClient.post<{ message: string; repositoryId: string; status: string }>(
      `/repositories/${repositoryId}/analyze`
    )
  }

  /**
   * Get repository details by ID
   */
  static async getRepository(repositoryId: string) {
    return await ApiClient.get<Repository>(`/repositories/${repositoryId}`)
  }

  /**
   * Get repository analysis results
   */
  static async getRepositoryAnalysis(repositoryId: string) {
    return await ApiClient.get<Analysis>(`/repositories/${repositoryId}/analysis`)
  }

  /**
   * Get analysis status
   */
  static async getAnalysisStatus(repositoryId: string) {
    return await ApiClient.get<{
      id?: string
      status: string
      startedAt?: string
      completedAt?: string
      errorMessage?: string
      message?: string
    }>(`/repositories/${repositoryId}/analysis/status`)
  }

  /**
   * Search repositories
   */
  static async searchRepositories(query: string) {
    return await ApiClient.get<Repository[]>('/repositories/search', {
      params: { q: query }
    })
  }
} 