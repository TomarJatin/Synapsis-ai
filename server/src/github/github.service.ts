import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import config from 'src/config'

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
  }
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  private: boolean
  html_url: string
  clone_url: string
  default_branch: string
}

export interface GitHubContent {
  name: string
  path: string
  type: 'file' | 'dir'
  content?: string
  encoding?: string
  size: number
}

export interface GitHubTree {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name)
  private readonly octokit: Octokit

  constructor() {
    this.octokit = new Octokit({
      auth: config().keys.github.accessToken,
    })
  }

  /**
   * Fetch all repositories for the authenticated user or organization
   */
  async getRepositories(organization?: string): Promise<GitHubRepository[]> {
    try {
      const { data } = organization 
        ? await this.octokit.rest.repos.listForOrg({
            org: organization,
            type: 'all',
            sort: 'updated',
            per_page: 100,
          })
        : await this.octokit.rest.repos.listForAuthenticatedUser({
            type: 'all',
            sort: 'updated',
            per_page: 100,
          })

      return data as GitHubRepository[]
    } catch (error) {
      this.logger.error('Failed to fetch repositories', error)
      throw new Error('Failed to fetch repositories from GitHub')
    }
  }

  /**
   * Get repository details by owner and name
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    try {
      const { data } = await this.octokit.rest.repos.get({
        owner,
        repo,
      })
      return data as GitHubRepository
    } catch (error) {
      this.logger.error(`Failed to fetch repository ${owner}/${repo}`, error)
      throw new Error(`Failed to fetch repository ${owner}/${repo}`)
    }
  }

  /**
   * Get the complete file tree of a repository
   */
  async getRepositoryTree(owner: string, repo: string, sha?: string): Promise<GitHubTree[]> {
    try {
      const repository = await this.getRepository(owner, repo)
      const treeSha = sha || repository.default_branch

      const { data } = await this.octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: 'true',
      })

      return data.tree as GitHubTree[]
    } catch (error) {
      this.logger.error(`Failed to fetch repository tree for ${owner}/${repo}`, error)
      throw new Error(`Failed to fetch repository tree for ${owner}/${repo}`)
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      })

      if (Array.isArray(data) || data.type !== 'file') {
        throw new Error(`Path ${path} is not a file`)
      }

      if (!data.content) {
        throw new Error(`No content found for file ${path}`)
      }

      // Decode base64 content
      return Buffer.from(data.content, 'base64').toString('utf8')
    } catch (error) {
      this.logger.error(`Failed to fetch file content for ${owner}/${repo}:${path}`, error)
      throw new Error(`Failed to fetch file content for ${path}`)
    }
  }

  /**
   * Get multiple files content in batch
   */
  async getMultipleFilesContent(
    owner: string, 
    repo: string, 
    paths: string[], 
    ref?: string
  ): Promise<Array<{ path: string; content: string | null; error?: string }>> {
    const results: Array<{ path: string; content: string | null; error?: string }> = []
    
    for (const path of paths) {
      try {
        const content = await this.getFileContent(owner, repo, path, ref)
        results.push({ path, content })
      } catch (error) {
        this.logger.warn(`Failed to fetch ${path}: ${error.message}`)
        results.push({ path, content: null, error: error.message })
      }
    }

    return results
  }

  /**
   * Get repository languages
   */
  async getRepositoryLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    try {
      const { data } = await this.octokit.rest.repos.listLanguages({
        owner,
        repo,
      })
      return data
    } catch (error) {
      this.logger.error(`Failed to fetch languages for ${owner}/${repo}`, error)
      return {}
    }
  }

  /**
   * Get README content
   */
  async getReadmeContent(owner: string, repo: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getReadme({
        owner,
        repo,
      })

      if (!data.content) {
        return null
      }

      return Buffer.from(data.content, 'base64').toString('utf8')
    } catch (error) {
      this.logger.warn(`No README found for ${owner}/${repo}`)
      return null
    }
  }

  /**
   * Check if repository exists and is accessible
   */
  async repositoryExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.getRepository(owner, repo)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get repository statistics
   */
  async getRepositoryStats(owner: string, repo: string) {
    try {
      const [languages, contributors] = await Promise.all([
        this.getRepositoryLanguages(owner, repo),
        this.octokit.rest.repos.listContributors({ owner, repo, per_page: 10 })
      ])

      return {
        languages,
        contributorsCount: contributors.data.length,
        topContributors: contributors.data.slice(0, 5).map(c => c.login),
      }
    } catch (error) {
      this.logger.error(`Failed to fetch stats for ${owner}/${repo}`, error)
      return {
        languages: {},
        contributorsCount: 0,
        topContributors: [],
      }
    }
  }
} 