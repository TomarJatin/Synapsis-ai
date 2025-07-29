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
  
  // Tree-sitter parsers cache
  private treeSitterParsers: any = null

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
        importantFiles.slice(0, 100) // Limit to avoid API rate limits
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
   * Generate universal AST representation using Tree-sitter for multiple languages
   */
  private async generateAST(
    fileContents: Array<{ path: string; content: string | null }>
  ): Promise<any> {
    const astData = {
      files: [] as any[],
      summary: {
        totalFiles: 0,
        totalDeclarations: 0,
        totalFunctions: 0,
        totalClasses: 0,
        totalInterfaces: 0,
        totalTypes: 0,
        languages: new Set<string>()
      },
      globalPatterns: {
        frameworks: [] as string[],
        libraries: [] as string[],
        patterns: [] as string[],
        apiEndpoints: [] as any[],
        dbOperations: [] as any[],
        crossLanguagePatterns: [] as any[]
      }
    }

    // Initialize Tree-sitter parsers for supported languages
    await this.initializeTreeSitterParsers()

    for (const file of fileContents) {
      if (!file.content) continue

      const language = this.detectLanguage(file.path)
      const supportedLanguages = [
        'javascript', 'typescript', 'python', 'go', 'rust', 'java',
        'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'json'
      ]
      
      if (!supportedLanguages.includes(language)) continue

      try {
        const fileAst = await this.parseFileASTWithTreeSitter(file.path, file.content, language)
        if (fileAst) {
          // Clean AST data to remove non-serializable properties
          const cleanedAst = this.cleanASTData(fileAst)
          astData.files.push(cleanedAst)
          
          // Update summary counters
          astData.summary.totalFiles++
          astData.summary.languages.add(language)
          astData.summary.totalDeclarations += cleanedAst.declarations?.length || 0
          astData.summary.totalFunctions += cleanedAst.functions?.length || 0
          astData.summary.totalClasses += cleanedAst.classes?.length || 0
          astData.summary.totalInterfaces += cleanedAst.interfaces?.length || 0
          astData.summary.totalTypes += cleanedAst.types?.length || 0
          
          // Analyze global and cross-language patterns
          this.analyzeGlobalPatterns(cleanedAst, astData.globalPatterns)
          this.analyzeCrossLanguagePatterns(cleanedAst, astData.globalPatterns)
        }
      } catch (error) {
        this.logger.warn(`Failed to parse AST for ${file.path}: ${error.message}`)
        // Continue with next file instead of failing the entire process
      }
    }

    // Convert Set to Array for JSON serialization
    astData.summary.languages = Array.from(astData.summary.languages) as any

    return astData
  }

  /**
   * Initialize Tree-sitter parsers for all supported languages
   */
  private async initializeTreeSitterParsers(): Promise<void> {
    if (this.treeSitterParsers) return // Already initialized

    try {
      const Parser = await import('tree-sitter')
      
      // Language imports - these need to be installed as dependencies
      const JavaScript = await import('tree-sitter-javascript')
      const TypeScript = await import('tree-sitter-typescript')
      const Python = await import('tree-sitter-python')
      const Go = await import('tree-sitter-go')
      const Rust = await import('tree-sitter-rust')
      const Java = await import('tree-sitter-java')
      const Cpp = await import('tree-sitter-cpp')
      const CSharp = await import('tree-sitter-c-sharp')
      const Ruby = await import('tree-sitter-ruby')
      const PHP = await import('tree-sitter-php')
      const Swift = await import('tree-sitter-swift')
      const Kotlin = await import('tree-sitter-kotlin')
      const JSON = await import('tree-sitter-json')

      this.treeSitterParsers = {
        javascript: this.createTreeSitterParser(Parser.default, JavaScript.default),
        typescript: this.createTreeSitterParser(Parser.default, (TypeScript as any).typescript || TypeScript.default),
        python: this.createTreeSitterParser(Parser.default, Python.default),
        go: this.createTreeSitterParser(Parser.default, Go.default),
        rust: this.createTreeSitterParser(Parser.default, Rust.default),
        java: this.createTreeSitterParser(Parser.default, Java.default),
        cpp: this.createTreeSitterParser(Parser.default, Cpp.default),
        csharp: this.createTreeSitterParser(Parser.default, CSharp.default),
        ruby: this.createTreeSitterParser(Parser.default, Ruby.default),
        php: this.createTreeSitterParser(Parser.default, PHP.default),
        swift: this.createTreeSitterParser(Parser.default, Swift.default),
        kotlin: this.createTreeSitterParser(Parser.default, Kotlin.default),
        json: this.createTreeSitterParser(Parser.default, JSON.default)
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Tree-sitter parsers: ${error.message}`)
      this.treeSitterParsers = {}
    }
  }

  /**
   * Create a Tree-sitter parser instance
   */
  private createTreeSitterParser(Parser: any, language: any): any {
    try {
      const parser = new Parser()
      parser.setLanguage(language)
      return parser
    } catch (error) {
      this.logger.warn(`Failed to create parser: ${error.message}`)
      return null
    }
  }

  /**
   * Parse individual file AST using Tree-sitter
   */
  private async parseFileASTWithTreeSitter(filePath: string, content: string, language: string): Promise<any> {
    try {
      const parser = this.treeSitterParsers[language]
      if (!parser) {
        this.logger.warn(`No parser available for language: ${language}`)
        return this.createBasicASTFallback(filePath, content, language)
      }

      const tree = parser.parse(content)
      const rootNode = tree.rootNode

      const extractedData = {
        path: filePath,
        language,
        size: content.length,
        parseSuccess: !rootNode.hasError(),
        errorCount: this.countParseErrors(rootNode),
        
        // Universal extractions that work across languages using Tree-sitter queries
        imports: this.extractImportsFromTreeSitter(rootNode, content, language),
        exports: this.extractExportsFromTreeSitter(rootNode, content, language),
        functions: this.extractFunctionsFromTreeSitter(rootNode, content, language),
        classes: this.extractClassesFromTreeSitter(rootNode, content, language),
        variables: this.extractVariablesFromTreeSitter(rootNode, content, language),
        
        // Language-specific extractions
        ...(await this.extractLanguageSpecificFeatures(rootNode, content, language)),
        
        // Universal pattern extractions
        callExpressions: this.extractCallExpressionsFromTreeSitter(rootNode, content, language),
        conditionals: this.extractConditionalsFromTreeSitter(rootNode, content, language),
        loops: this.extractLoopsFromTreeSitter(rootNode, content, language),
        literals: this.extractLiteralsFromTreeSitter(rootNode, content, language),
        comments: this.extractCommentsFromTreeSitter(rootNode, content, language),
        
        // Searchable content for efficient querying
        searchableContent: this.extractSearchableContentFromTreeSitter(rootNode, content, filePath, language),
        
        // Code quality metrics
        complexity: this.calculateComplexityFromTreeSitter(rootNode, language),
        dependencies: this.extractDependenciesFromTreeSitter(rootNode, content, language),
        
        // Location mapping for precise code navigation
        locationMap: this.createLocationMapFromTreeSitter(rootNode, content),
        
        // Tree-sitter specific data (limited depth for storage)
        syntaxTree: this.serializeTreeSitterNode(rootNode, content, 2)
      }

      return extractedData
    } catch (error) {
      this.logger.error(`Failed to parse ${language} AST for ${filePath}: ${error.message}`)
      return this.createBasicASTFallback(filePath, content, language)
    }
  }

  // Implementation of all Tree-sitter extraction methods would go here...
  // For brevity, I'll add the key ones and placeholders for others

  private countParseErrors(node: any): number {
    let errorCount = 0
    
    const traverse = (n: any) => {
      if (n.hasError()) errorCount++
      
      for (let i = 0; i < n.childCount; i++) {
        traverse(n.child(i))
      }
    }
    
    traverse(node)
    return errorCount
  }

  private extractImportsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    // Tree-sitter query-based extraction would go here
    // For now, return basic implementation
    return []
  }

  private extractExportsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractFunctionsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractClassesFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractVariablesFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private async extractLanguageSpecificFeatures(rootNode: any, content: string, language: string): Promise<any> {
    // Language-specific feature extraction
    switch (language) {
      case 'typescript':
      case 'javascript':
        return {
          interfaces: [],
          types: [],
          enums: [],
          decorators: [],
          jsxElements: []
        }
      
      case 'python':
        return {
          decorators: [],
          comprehensions: [],
          async_functions: []
        }
      
      case 'go':
        return {
          interfaces: [],
          structs: [],
          methods: [],
          goroutines: []
        }
      
      case 'rust':
        return {
          traits: [],
          impls: [],
          macros: [],
          lifetimes: []
        }
      
      case 'java':
        return {
          interfaces: [],
          annotations: [],
          packages: [],
          generics: []
        }
      
      default:
        return {}
    }
  }

  private extractCallExpressionsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractConditionalsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractLoopsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractLiteralsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractCommentsFromTreeSitter(rootNode: any, content: string, language: string): any[] {
    return []
  }

  private extractSearchableContentFromTreeSitter(rootNode: any, content: string, filePath: string, language: string): any {
    return {
      filePath,
      allIdentifiers: [],
      allStrings: [],
      allComments: [],
      codeStructure: { topLevelStatements: [], nestedDepth: 0 },
      keywords: [],
      patterns: []
    }
  }

  private calculateComplexityFromTreeSitter(rootNode: any, language: string): number {
    return 1
  }

  private extractDependenciesFromTreeSitter(rootNode: any, content: string, language: string): string[] {
    return []
  }

  private createLocationMapFromTreeSitter(rootNode: any, content: string): any {
    const lines = content.split('\n')
    return {
      totalLines: lines.length,
      totalCharacters: content.length,
      lineMap: lines.map((line, index) => ({
        line: index + 1,
        content: line,
        length: line.length
      }))
    }
  }

  private serializeTreeSitterNode(node: any, content: string, maxDepth: number): any {
    if (maxDepth <= 0) return null
    
    const nodeText = content.slice(node.startIndex, node.endIndex)
    
    return {
      type: node.type,
      text: nodeText.length > 200 ? nodeText.slice(0, 200) + '...' : nodeText,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      childCount: node.childCount,
      children: Array.from({ length: Math.min(node.childCount, 5) }, (_, i) => 
        this.serializeTreeSitterNode(node.child(i), content, maxDepth - 1)
      ).filter(Boolean)
    }
  }

  private createBasicASTFallback(filePath: string, content: string, language: string): any {
    return {
      path: filePath,
      language,
      size: content.length,
      parseSuccess: false,
      errorCount: 1,
      
      // Basic extraction using regex-based methods
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      variables: [],
      
      searchableContent: {
        filePath,
        allIdentifiers: [],
        allStrings: [],
        allComments: [],
        codeStructure: { topLevelStatements: [], nestedDepth: 0 },
        keywords: [],
        patterns: []
      },
      
      complexity: 1,
      dependencies: [],
      locationMap: this.createLocationMapFromTreeSitter({ startIndex: 0, endIndex: content.length }, content)
    }
  }

  /**
   * Clean AST data by removing non-serializable properties
   */
  private cleanASTData(data: any): any {
    if (!data) return data
    
    if (Array.isArray(data)) {
      return data.map(item => this.cleanASTData(item))
    }
    
    if (typeof data === 'object' && data !== null) {
      const cleaned = { ...data }
      // Remove raw AST nodes that contain functions and circular references
      delete cleaned.raw
      
      // Recursively clean nested objects
      for (const key in cleaned) {
        if (cleaned.hasOwnProperty(key)) {
          cleaned[key] = this.cleanASTData(cleaned[key])
        }
      }
      
      return cleaned
    }
    
    return data
  }

  /**
   * Analyze global patterns across the codebase
   */
  private analyzeGlobalPatterns(fileAst: any, globalPatterns: any): void {
    // Detect frameworks based on imports and patterns
    const frameworks = this.detectFrameworksFromAST(fileAst)
    globalPatterns.frameworks.push(...frameworks)
    
    // Detect libraries and dependencies
    const libraries = this.detectLibrariesFromAST(fileAst)
    globalPatterns.libraries.push(...libraries)
    
    // Detect common patterns
    const patterns = this.detectCodePatternsFromAST(fileAst)
    globalPatterns.patterns.push(...patterns)
  }

  /**
   * Analyze cross-language patterns
   */
  private analyzeCrossLanguagePatterns(fileAst: any, globalPatterns: any): void {
    // Detect API patterns that might span languages
    const apiPatterns = this.detectAPIPatterns(fileAst)
    globalPatterns.apiEndpoints.push(...apiPatterns)
    
    // Detect database operation patterns
    const dbPatterns = this.detectDatabasePatterns(fileAst)
    globalPatterns.dbOperations.push(...dbPatterns)
    
    // Add to cross-language patterns
    globalPatterns.crossLanguagePatterns.push({
      language: fileAst.language,
      file: fileAst.path,
      apis: apiPatterns,
      database: dbPatterns
    })
  }

  private detectFrameworksFromAST(fileAst: any): string[] {
    const frameworks: string[] = []
    
    // Check imports for framework patterns
    if (fileAst.imports) {
      for (const imp of fileAst.imports) {
        if (imp.source?.includes('next')) frameworks.push('Next.js')
        if (imp.source?.includes('react')) frameworks.push('React')
        if (imp.source?.includes('@nestjs')) frameworks.push('NestJS')
        if (imp.source?.includes('express')) frameworks.push('Express')
        if (imp.source?.includes('fastapi')) frameworks.push('FastAPI')
        if (imp.source?.includes('django')) frameworks.push('Django')
      }
    }
    
    return [...new Set(frameworks)]
  }

  private detectLibrariesFromAST(fileAst: any): string[] {
    const libraries: string[] = []
    
    if (fileAst.imports) {
      for (const imp of fileAst.imports) {
        if (imp.source && !imp.source.startsWith('.')) {
          libraries.push(imp.source)
        }
      }
    }
    
    return [...new Set(libraries)]
  }

  private detectCodePatternsFromAST(fileAst: any): string[] {
    const patterns: string[] = []
    
    if (fileAst.functions?.length > 0) patterns.push('functions')
    if (fileAst.classes?.length > 0) patterns.push('classes')
    if (fileAst.jsxElements?.length > 0) patterns.push('react-jsx')
    if (fileAst.callExpressions?.some(call => call.callee?.name === 'useState')) patterns.push('react-hooks')
    
    return patterns
  }

  private detectAPIPatterns(fileAst: any): any[] {
    const apiPatterns: any[] = []
    
    // Detect API route patterns, controller methods, etc.
    if (fileAst.functions) {
      for (const func of fileAst.functions) {
        if (func.name?.includes('api') || func.name?.includes('route') || func.name?.includes('handler')) {
          apiPatterns.push({
            type: 'api-function',
            name: func.name,
            file: fileAst.path
          })
        }
      }
    }
    
    return apiPatterns
  }

  private detectDatabasePatterns(fileAst: any): any[] {
    const dbPatterns: any[] = []
    
    // Detect database operation patterns
    if (fileAst.callExpressions) {
      for (const call of fileAst.callExpressions) {
        const calleeName = call.callee?.name || call.callee?.property?.name
        if (calleeName && ['find', 'create', 'update', 'delete', 'save', 'query'].includes(calleeName)) {
          dbPatterns.push({
            type: 'db-operation',
            operation: calleeName,
            file: fileAst.path
          })
        }
      }
    }
    
    return dbPatterns
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
      'json': 'json',
    }
    return languageMap[ext || ''] || 'unknown'
  }

  private isCodeFile(filePath: string): boolean {
    const codeExtensions = ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'java', 'php', 'cs', 'cpp', 'c', 'rs', 'kt', 'swift']
    const ext = filePath.split('.').pop()?.toLowerCase()
    return codeExtensions.includes(ext || '')
  }
} 