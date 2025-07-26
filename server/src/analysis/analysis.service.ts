import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/prisma/prisma.service'
import { LLMService } from 'src/llm/llm.service'
import { GitHubService, GitHubRepository, GitHubTree } from 'src/github/github.service'
import { AnalysisStatus } from '@prisma/client'
import { z } from 'zod'

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

// Zod schemas for structured LLM outputs
const RepositoryFeatureSchema = z.object({
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  type: z.enum(['authentication', 'api', 'database', 'ui', 'testing', 'deployment', 'other']),
  implementation: z.string(),
  dependencies: z.array(z.string()),
})

const RepositoryFeaturesSchema = z.object({
  features: z.array(RepositoryFeatureSchema)
})

const RepositoryStructureSchema = z.object({
  architecture: z.string(),
  patterns: z.array(z.string()),
  directories: z.array(z.object({
    path: z.string(),
    purpose: z.string(),
    importance: z.number(),
  })),
  entryPoints: z.array(z.string()),
  configFiles: z.array(z.string()),
})

const TechStackSchema = z.object({
  frontend: z.array(z.string()).optional(),
  backend: z.array(z.string()).optional(),
  database: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  frameworks: z.array(z.string()).optional(),
  languages: z.array(z.string()),
})

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LLMService,
    private readonly githubService: GitHubService,
  ) {}

  /**
   * Analyze a repository with streaming updates
   */
  async analyzeRepositoryWithStreaming(
    repositoryId: string, 
    streamCallback: (event: string, data: any) => void
  ): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    })

    if (!repository) {
      throw new Error('Repository not found')
    }

    // Create analysis record
    const analysis = await this.prisma.analysis.create({
      data: {
        repositoryId,
        status: AnalysisStatus.IN_PROGRESS,
      },
    })

    try {
      this.logger.log(`Starting streaming analysis for repository: ${repository.fullName}`)
      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Fetching repository structure...',
        step: 1,
        totalSteps: 7
      })

      // Get repository tree and important files
      const [owner, repoName] = repository.fullName.split('/')
      const tree = await this.githubService.getRepositoryTree(owner, repoName)
      
      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Analyzing important files...',
        step: 2,
        totalSteps: 7
      })
      
      // Filter and prioritize important files
      const importantFiles = this.getImportantFiles(tree);
      console.log("importantFiles length...",  importantFiles.length)
      
      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: `Fetching content from ${importantFiles.length} important files...`,
        step: 3,
        totalSteps: 7
      })
      
      // Get file contents
      const fileContents = await this.githubService.getMultipleFilesContent(
        owner, 
        repoName, 
        importantFiles.slice(0, 50) // Limit to avoid API rate limits
      )

      // Get README content
      const readmeContent = await this.githubService.getReadmeContent(owner, repoName)
      
      // Get repository stats
      const stats = await this.githubService.getRepositoryStats(owner, repoName)

      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Extracting features with AI...',
        step: 4,
        totalSteps: 7
      })

      // Analyze with LLM - Features
      let features: RepositoryFeature[] = []
      try {
        features = await this.extractFeatures(fileContents, readmeContent)
        streamCallback('progress', { 
          type: 'features',
          data: features,
          message: `Identified ${features.length} features`
        })
      } catch (error) {
        console.error('Feature extraction error:', error)
        streamCallback('progress', { 
          type: 'features',
          data: features,
          message: 'Feature extraction skipped due to error'
        })
      }

      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Analyzing repository structure...',
        step: 5,
        totalSteps: 7
      })

      // Analyze structure
      let structure: RepositoryStructure = {
        architecture: 'unknown',
        patterns: [],
        directories: [],
        entryPoints: [],
        configFiles: []
      }
      try {
        structure = await this.analyzeStructure(tree, fileContents)
        streamCallback('progress', { 
          type: 'structure',
          data: structure,
          message: `Architecture: ${structure.architecture}`
        })
      } catch (error) {
        console.error('Structure analysis error:', error)
        streamCallback('progress', { 
          type: 'structure',
          data: structure,
          message: 'Structure analysis skipped due to error'
        })
      }

      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Extracting technology stack...',
        step: 6,
        totalSteps: 7
      })

      // Extract tech stack
      let techStack: TechStack = { languages: [] }
      try {
        techStack = await this.extractTechStack(fileContents, stats.languages)
        streamCallback('progress', { 
          type: 'techStack',
          data: techStack,
          message: `Languages: ${techStack.languages.join(', ')}`
        })
      } catch (error) {
        console.error('Tech stack analysis error:', error)
        streamCallback('progress', { 
          type: 'techStack',
          data: techStack,
          message: 'Tech stack analysis skipped due to error'
        })
      }

      // Generate AST and calculate metrics
      const [astData, codeMetrics] = await Promise.all([
        this.generateAST(fileContents),
        Promise.resolve(this.calculateCodeMetrics(fileContents, tree))
      ])

      streamCallback('status', { 
        status: 'IN_PROGRESS', 
        message: 'Generating summary...',
        step: 7,
        totalSteps: 7
      })

      // Generate summary
      const summary = await this.generateSummary(features, structure, techStack, readmeContent)

      // Update analysis with results
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: AnalysisStatus.COMPLETED,
          completedAt: new Date(),
          features: features as any,
          structure: structure as any,
          dependencies: stats.languages,
          documentation: { readme: readmeContent },
          codeMetrics: codeMetrics as any,
          astData: astData as any,
          searchableContent: this.createSearchableContent(features, structure, fileContents),
          summary,
          techStack: techStack as any,
          complexity: codeMetrics.complexity,
        },
      })

      // Update repository last analyzed timestamp
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { lastAnalyzed: new Date() },
      })

      this.logger.log(`Streaming analysis completed for repository: ${repository.fullName}`)
    } catch (error) {
      this.logger.error(`Streaming analysis failed for repository: ${repository.fullName}`, error)
      
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: AnalysisStatus.FAILED,
          completedAt: new Date(),
          errorMessage: error.message,
        },
      })
      
      throw error
    }
  }

  /**
   * Analyze a repository and save results to database
   */
  async analyzeRepository(repositoryId: string): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    })

    if (!repository) {
      throw new Error('Repository not found')
    }

    // Create analysis record
    const analysis = await this.prisma.analysis.create({
      data: {
        repositoryId,
        status: AnalysisStatus.IN_PROGRESS,
      },
    })

    try {
      this.logger.log(`Starting analysis for repository: ${repository.fullName}`)

      // Get repository tree and important files
      const [owner, repoName] = repository.fullName.split('/')
      const tree = await this.githubService.getRepositoryTree(owner, repoName)
      
      // Filter and prioritize important files
      const importantFiles = this.getImportantFiles(tree);

      console.log("importantFiles length...",  importantFiles.length)
      
      // Get file contents
      const fileContents = await this.githubService.getMultipleFilesContent(
        owner, 
        repoName, 
        importantFiles.slice(0, 50) // Limit to avoid API rate limits
      )

      // Get README content
      const readmeContent = await this.githubService.getReadmeContent(owner, repoName)
      
      // Get repository stats
      const stats = await this.githubService.getRepositoryStats(owner, repoName)

      // Analyze with LLM
      const [features, structure, techStack, astData] = await Promise.all([
        this.extractFeatures(fileContents, readmeContent),
        this.analyzeStructure(tree, fileContents),
        this.extractTechStack(fileContents, stats.languages),
        this.generateAST(fileContents),
      ])

      // Calculate code metrics
      const codeMetrics = this.calculateCodeMetrics(fileContents, tree)

      // Generate summary
      const summary = await this.generateSummary(features, structure, techStack, readmeContent)

      // Update analysis with results
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: AnalysisStatus.COMPLETED,
          completedAt: new Date(),
          features: features as any,
          structure: structure as any,
          dependencies: stats.languages,
          documentation: { readme: readmeContent },
          codeMetrics: codeMetrics as any,
          astData: astData as any,
          searchableContent: this.createSearchableContent(features, structure, fileContents),
          summary,
          techStack: techStack as any,
          complexity: codeMetrics.complexity,
        },
      })

      // Update repository last analyzed timestamp
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { lastAnalyzed: new Date() },
      })

      this.logger.log(`Analysis completed for repository: ${repository.fullName}`)
    } catch (error) {
      this.logger.error(`Analysis failed for repository: ${repository.fullName}`, error)
      
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: AnalysisStatus.FAILED,
          completedAt: new Date(),
          errorMessage: error.message,
        },
      })
      
      throw error
    }
  }

  /**
   * Get important files for analysis based on file patterns
   */
  private getImportantFiles(tree: GitHubTree[]): string[] {
    const importantPatterns = [
      // Config files
      /^package\.json$/,
      /^composer\.json$/,
      /^requirements\.txt$/,
      /^Gemfile$/,
      /^pom\.xml$/,
      /^build\.gradle$/,
      /^Cargo\.toml$/,
      /^go\.mod$/,
      
      // Framework files
      /next\.config\./,
      /nuxt\.config\./,
      /vue\.config\./,
      /angular\.json$/,
      /tsconfig\.json$/,
      /webpack\.config\./,
      /vite\.config\./,
      
      // API/Server files
      /app\.(js|ts|py|rb|go|php)$/,
      /main\.(js|ts|py|rb|go|php)$/,
      /index\.(js|ts|py|rb|go|php)$/,
      /server\.(js|ts|py|rb|go|php)$/,
      
      // Database/Schema files
      /schema\.(js|ts|py|rb|sql)$/,
      /models?\//,
      /migrations?\//,
      /\.prisma$/,
      
      // Documentation
      /README\./i,
      /CONTRIBUTING\./i,
      /CHANGELOG\./i,
      /LICENSE/i,
      
      // Docker
      /Dockerfile$/,
      /docker-compose\./,
      
      // CI/CD
      /\.github\/workflows\//,
      /\.gitlab-ci\./,
      /Jenkinsfile$/,
    ]

    const mediumImportancePatterns = [
      /\.(js|ts|jsx|tsx|py|rb|go|php|java|cs|cpp|c|rs|kt|swift)$/,
    ]

    const files = tree.filter(item => item.type === 'blob')
    
    // Priority 1: Highly important files
    const highPriority = files.filter(file => 
      importantPatterns.some(pattern => pattern.test(file.path))
    ).map(f => f.path)

    // Priority 2: Source code files (limited)
    const mediumPriority = files.filter(file => 
      mediumImportancePatterns.some(pattern => pattern.test(file.path)) &&
      !highPriority.includes(file.path) &&
      !file.path.includes('node_modules') &&
      !file.path.includes('.git') &&
      !file.path.includes('vendor') &&
      !file.path.includes('build') &&
      !file.path.includes('dist')
    ).slice(0, 30).map(f => f.path)

    return [...highPriority, ...mediumPriority]
  }

  /**
   * Extract features using LLM analysis
   */
  private async extractFeatures(
    fileContents: Array<{ path: string; content: string | null }>,
    readmeContent: string | null
  ): Promise<RepositoryFeature[]> {
    const codeContext = fileContents
      .filter(f => f.content)
      .slice(0, 20)
      .map(f => `File: ${f.path}\n${f.content}`)
      .join('\n\n---\n\n')

    const prompt = `Analyze this repository and identify all features and functionalities implemented. 

README Content:
${readmeContent || 'No README available'}

Code Files:
${codeContext}

Identify features like:
- Authentication systems
- API endpoints and services  
- Database operations
- UI components and pages
- Testing setup
- Deployment configuration
- Third-party integrations
- Custom utilities and helpers

For each feature, provide:
- name: Clear feature name
- description: What it does
- files: Key files implementing this feature
- type: Category (authentication, api, database, ui, testing, deployment, other)
- implementation: Brief technical description
- dependencies: Related technologies/packages

Return as JSON object with features array.`

    const result = await this.llmService.generate<{ features: RepositoryFeature[] }>({
      messages: [
        { role: 'system', content: 'You are an expert code analyst. Analyze repositories and extract features in JSON format.' },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
      },
      schema: RepositoryFeaturesSchema,
    })

    return result.features
  }

  /**
   * Analyze repository structure
   */
  private async analyzeStructure(
    tree: GitHubTree[],
    fileContents: Array<{ path: string; content: string | null }>
  ): Promise<RepositoryStructure> {
    const directories = [...new Set(tree.map(item => item.path.split('/')[0]))]
      .filter(dir => dir !== '' && !dir.startsWith('.'))
      .slice(0, 20)

    const prompt = `Analyze this repository structure and provide architectural insights:

Directory Structure:
${directories.join('\n')}

Key Files:
${fileContents.filter(f => f.content).slice(0, 10).map(f => f.path).join('\n')}

Sample Code Context:
${fileContents.filter(f => f.content).slice(0, 5).map(f => `${f.path}:\n${f.content?.substring(0, 500)}`).join('\n\n')}

Provide analysis in JSON format:
{
  "architecture": "overall architecture pattern (MVC, microservices, monolith, etc.)",
  "patterns": ["design patterns used"],
  "directories": [{"path": "dir", "purpose": "what this directory contains", "importance": 1-10}],
  "entryPoints": ["main application entry files"],
  "configFiles": ["configuration files"]
}`

    return await this.llmService.generate<RepositoryStructure>({
      messages: [
        { role: 'system', content: 'You are an expert software architect. Analyze repository structure and return JSON.' },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
      },
      schema: RepositoryStructureSchema,
    })
  }

  /**
   * Extract technology stack
   */
  private async extractTechStack(
    fileContents: Array<{ path: string; content: string | null }>,
    languages: Record<string, number>
  ): Promise<TechStack> {
    const packageFiles = fileContents.filter(f => 
      f.path.includes('package.json') || 
      f.path.includes('requirements.txt') ||
      f.path.includes('Gemfile') ||
      f.path.includes('composer.json') ||
      f.path.includes('pom.xml') ||
      f.path.includes('Cargo.toml')
    )

    const configFiles = fileContents.filter(f => 
      f.path.includes('config') || 
      f.path.includes('.env') ||
      f.path.includes('docker') ||
      f.path.includes('webpack') ||
      f.path.includes('vite')
    )

    const prompt = `Analyze the technology stack of this repository:

Languages (by bytes):
${Object.entries(languages).map(([lang, bytes]) => `${lang}: ${bytes}`).join('\n')}

Package Files:
${packageFiles.map(f => `${f.path}:\n${f.content}`).join('\n\n')}

Config Files:
${configFiles.map(f => `${f.path}:\n${f.content?.substring(0, 1000)}`).join('\n\n')}

Extract and categorize technologies in JSON format:
{
  "frontend": ["frontend frameworks/libraries"],
  "backend": ["backend frameworks/libraries"], 
  "database": ["database technologies"],
  "tools": ["build tools, bundlers, etc."],
  "frameworks": ["major frameworks used"],
  "languages": ["programming languages"]
}`

    return await this.llmService.generate<TechStack>({
      messages: [
        { role: 'system', content: 'You are a tech stack analyst. Extract technologies from code and return JSON.' },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
      },
      schema: TechStackSchema,
    })
  }

  /**
   * Generate AST representation
   */
  private async generateAST(
    fileContents: Array<{ path: string; content: string | null }>
  ): Promise<any> {
    // For now, create a simplified AST structure
    // In a full implementation, you'd use proper AST parsers for each language
    const astData = {
      files: fileContents.filter(f => f.content).map(f => ({
        path: f.path,
        language: this.detectLanguage(f.path),
        size: f.content?.length || 0,
        functions: this.extractFunctions(f.content || ''),
        imports: this.extractImports(f.content || ''),
        exports: this.extractExports(f.content || ''),
      }))
    }

    return astData
  }

  /**
   * Generate repository summary
   */
  private async generateSummary(
    features: RepositoryFeature[],
    structure: RepositoryStructure,
    techStack: TechStack,
    readmeContent: string | null
  ): Promise<string> {
    const prompt = `Create a comprehensive summary of this repository:

Features:
${features.map(f => `- ${f.name}: ${f.description}`).join('\n')}

Architecture: ${structure.architecture}
Tech Stack: ${JSON.stringify(techStack)}

README:
${readmeContent || 'No README available'}

Create a clear, concise summary that explains:
1. What this repository does
2. Main features and capabilities  
3. Technology stack and architecture
4. How it's organized
5. Key implementation details

Keep it under 500 words and make it useful for developers who want to understand and potentially reuse this code.`

    return await this.llmService.generate<string>({
      messages: [
        { role: 'system', content: 'You are a technical writer. Create clear, informative repository summaries.' },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'string',
      modelConfig: {
        model: 'anthropic',
        name: 'claude-3-5-sonnet-20241022',
      },
    })
  }

  /**
   * Calculate code metrics
   */
  private calculateCodeMetrics(
    fileContents: Array<{ path: string; content: string | null }>,
    tree: GitHubTree[]
  ): CodeMetrics {
    const codeFiles = fileContents.filter(f => f.content && this.isCodeFile(f.path))
    const totalLines = codeFiles.reduce((sum, f) => sum + (f.content?.split('\n').length || 0), 0)
    
    // Simple complexity calculation based on file count and lines
    let complexity: 'low' | 'medium' | 'high' = 'low'
    if (codeFiles.length > 50 || totalLines > 10000) complexity = 'high'
    else if (codeFiles.length > 20 || totalLines > 5000) complexity = 'medium'

    return {
      totalFiles: tree.filter(item => item.type === 'blob').length,
      linesOfCode: totalLines,
      complexity,
      maintainability: Math.max(1, Math.min(10, 10 - (codeFiles.length / 10))),
    }
  }

  /**
   * Create searchable content for future queries
   */
  private createSearchableContent(
    features: RepositoryFeature[],
    structure: RepositoryStructure,
    fileContents: Array<{ path: string; content: string | null }>
  ): any {
    return {
      features: features.map(f => ({ name: f.name, description: f.description, type: f.type })),
      architecture: structure.architecture,
      patterns: structure.patterns,
      directories: structure.directories.map(d => d.path),
      keywords: [
        ...features.flatMap(f => f.name.toLowerCase().split(' ')),
        ...structure.patterns,
        structure.architecture.toLowerCase(),
      ],
      fileTypes: [...new Set(fileContents.map(f => this.detectLanguage(f.path)))],
    }
  }

  /**
   * Helper methods
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'java': 'java',
      'php': 'php',
      'cs': 'csharp',
      'cpp': 'cpp',
      'c': 'c',
      'rs': 'rust',
      'kt': 'kotlin',
      'swift': 'swift',
    }
    return languageMap[ext || ''] || 'unknown'
  }

  private isCodeFile(filePath: string): boolean {
    const codeExtensions = ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'java', 'php', 'cs', 'cpp', 'c', 'rs', 'kt', 'swift']
    const ext = filePath.split('.').pop()?.toLowerCase()
    return codeExtensions.includes(ext || '')
  }

  private extractFunctions(content: string): string[] {
    // Simplified function extraction - would need proper AST parsing for accuracy
    const functionPatterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=/g,
      /def\s+(\w+)/g,
      /func\s+(\w+)/g,
    ]
    
    const functions: string[] = []
    functionPatterns.forEach(pattern => {
      const matches = content.matchAll(pattern)
      for (const match of matches) {
        if (match[1]) functions.push(match[1])
      }
    })
    
    return [...new Set(functions)]
  }

  private extractImports(content: string): string[] {
    const importPatterns = [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g,
      /from\s+(\w+)\s+import/g,
    ]
    
    const imports: string[] = []
    importPatterns.forEach(pattern => {
      const matches = content.matchAll(pattern)
      for (const match of matches) {
        if (match[1]) imports.push(match[1])
      }
    })
    
    return [...new Set(imports)]
  }

  private extractExports(content: string): string[] {
    const exportPatterns = [
      /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g,
      /export\s*{\s*([^}]+)\s*}/g,
    ]
    
    const exports: string[] = []
    exportPatterns.forEach(pattern => {
      const matches = content.matchAll(pattern)
      for (const match of matches) {
        if (match[1]) {
          if (match[1].includes(',')) {
            exports.push(...match[1].split(',').map(s => s.trim()))
          } else {
            exports.push(match[1])
          }
        }
      }
    })
    
    return [...new Set(exports)]
  }
} 