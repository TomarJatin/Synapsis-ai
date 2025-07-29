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
   * Generate comprehensive AST representation for JavaScript, TypeScript, and JSON files
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
      }
    }

    for (const file of fileContents) {
      if (!file.content) continue

      const language = this.detectLanguage(file.path)
      if (!['javascript', 'typescript', 'json'].includes(language)) continue

      try {
        const fileAst = await this.parseFileAST(file.path, file.content, language)
        if (fileAst) {
          astData.files.push(fileAst)
          astData.summary.totalFiles++
          astData.summary.languages.add(language)
          
          // Update summary counters
          astData.summary.totalDeclarations += fileAst.declarations?.length || 0
          astData.summary.totalFunctions += fileAst.functions?.length || 0
          astData.summary.totalClasses += fileAst.classes?.length || 0
          astData.summary.totalInterfaces += fileAst.interfaces?.length || 0
          astData.summary.totalTypes += fileAst.types?.length || 0
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
   * Parse individual file AST based on language
   */
  private async parseFileAST(filePath: string, content: string, language: string): Promise<any> {
    switch (language) {
      case 'json':
        return await this.parseJSONAST(filePath, content)
      case 'javascript':
      case 'typescript':
        return await this.parseJSTypeScriptAST(filePath, content, language)
      default:
        return null
    }
  }

  /**
   * Parse JSON files
   */
  private async parseJSONAST(filePath: string, content: string): Promise<any> {
    try {
      const parsed = JSON.parse(content)
      return {
        path: filePath,
        language: 'json',
        type: 'json',
        size: content.length,
        structure: this.analyzeJSONStructure(parsed),
        keys: this.extractJSONKeys(parsed),
        depth: this.calculateJSONDepth(parsed),
        schema: this.inferJSONSchema(parsed),
        searchableContent: this.extractJSONSearchableContent(parsed, filePath)
      }
    } catch (error) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    }
  }

  /**
   * Parse JavaScript/TypeScript files using Babel parser
   */
  private async parseJSTypeScriptAST(filePath: string, content: string, language: string): Promise<any> {
    try {
      // Import babel parser dynamically - handle missing dependency gracefully
      let babel: any
      try {
        babel = await import('@babel/parser')
      } catch (error) {
        this.logger.warn(`@babel/parser not available, falling back to basic AST for ${filePath}`)
        return this.createBasicAST(filePath, content, language)
      }
      
      const plugins = [
        'jsx',
        'decorators-legacy',
        'classProperties',
        'objectRestSpread',
        'asyncGenerators',
        'functionBind',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'dynamicImport',
        'nullishCoalescingOperator',
        'optionalChaining',
        'optionalCatchBinding',
        'throwExpressions',
        'topLevelAwait'
      ]

      if (language === 'typescript') {
        plugins.push('typescript')
      }

      const ast = babel.parse(content, {
        sourceType: 'module',
        plugins,
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true
      })

      return {
        path: filePath,
        language,
        size: content.length,
        // Note: Full AST removed to avoid serialization issues
        
        // Extracted and organized data for efficient searching
        imports: this.cleanASTData(this.extractImportsFromAST(ast)),
        exports: this.cleanASTData(this.extractExportsFromAST(ast)),
        functions: this.cleanASTData(this.extractFunctionsFromAST(ast)),
        classes: this.cleanASTData(this.extractClassesFromAST(ast)),
        variables: this.cleanASTData(this.extractVariablesFromAST(ast)),
        interfaces: language === 'typescript' ? this.cleanASTData(this.extractInterfacesFromAST(ast)) : [],
        types: language === 'typescript' ? this.cleanASTData(this.extractTypesFromAST(ast)) : [],
        enums: language === 'typescript' ? this.cleanASTData(this.extractEnumsFromAST(ast)) : [],
        decorators: this.cleanASTData(this.extractDecoratorsFromAST(ast)),
        comments: this.cleanASTData(this.extractCommentsFromAST(ast, content)),
        
        // Additional detailed extractions for comprehensive search
        callExpressions: this.cleanASTData(this.extractCallExpressions(ast)),
        jsxElements: this.cleanASTData(this.extractJSXElements(ast)),
        objectPatterns: this.cleanASTData(this.extractObjectPatterns(ast)),
        conditionals: this.cleanASTData(this.extractConditionals(ast)),
        loops: this.cleanASTData(this.extractLoops(ast)),
        memberExpressions: this.cleanASTData(this.extractMemberExpressions(ast)),
        literals: this.cleanASTData(this.extractLiterals(ast)),
        assignments: this.cleanASTData(this.extractAssignments(ast)),
        
        // Searchable content for text-based queries
        searchableContent: this.extractSearchableContent(ast, content, filePath),
        
        // Metrics and analysis
        complexity: this.calculateComplexityFromAST(ast),
        dependencies: this.extractDependenciesFromAST(ast),
        
        // Location mappings for precise code navigation
        locationMap: this.createLocationMap(ast, content)
      }
    } catch (error) {
      throw new Error(`Failed to parse ${language} AST for ${filePath}: ${error.message}`)
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
   * Create basic AST fallback when babel parser is not available
   */
  private createBasicAST(filePath: string, content: string, language: string): any {
    return {
      path: filePath,
      language,
      size: content.length,
      ast: null, // No full AST available
      
      // Basic extraction using the old regex-based methods
      imports: this.extractImports(content),
      exports: this.extractExports(content),
      functions: this.extractFunctions(content),
      classes: [],
      variables: [],
      interfaces: [],
      types: [],
      enums: [],
      decorators: [],
      comments: [],
      
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
      locationMap: this.createLocationMap({ body: [] }, content)
    }
  }

  /**
   * Extract imports with full details
   */
  private extractImportsFromAST(ast: any): any[] {
    const imports: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'ImportDeclaration') {
        imports.push({
          source: node.source.value,
          specifiers: node.specifiers.map(spec => ({
            type: spec.type,
            imported: spec.imported?.name || null,
            local: spec.local.name,
            isDefault: spec.type === 'ImportDefaultSpecifier',
            isNamespace: spec.type === 'ImportNamespaceSpecifier'
          })),
          location: node.loc,
          raw: node
        })
      }
      
      // Handle dynamic imports
      if (node.type === 'CallExpression' && 
          node.callee.type === 'Import') {
        imports.push({
          source: node.arguments[0]?.value || 'dynamic',
          type: 'dynamic',
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return imports
  }

  /**
   * Extract exports with full details
   */
  private extractExportsFromAST(ast: any): any[] {
    const exports: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          // Export declaration (export const foo = ...)
          exports.push({
            type: 'named',
            name: this.getDeclarationName(node.declaration),
            declarationType: node.declaration.type,
            location: node.loc,
            raw: node
          })
        } else {
          // Export specifiers (export { foo, bar })
          node.specifiers.forEach(spec => {
            exports.push({
              type: 'named',
              name: spec.exported.name,
              local: spec.local.name,
              location: spec.loc,
              raw: node
            })
          })
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        exports.push({
          type: 'default',
          name: this.getDeclarationName(node.declaration) || 'default',
          declarationType: node.declaration.type,
          location: node.loc,
          raw: node
        })
      } else if (node.type === 'ExportAllDeclaration') {
        exports.push({
          type: 'all',
          source: node.source.value,
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return exports
  }

  /**
   * Extract functions with comprehensive details
   */
  private extractFunctionsFromAST(ast: any): any[] {
    const functions: any[] = []
    
    const traverse = (node: any, parent?: any) => {
      if (['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) {
        functions.push({
          name: node.id?.name || this.getFunctionName(node, parent),
          type: node.type,
          params: node.params.map(param => this.extractParameter(param)),
          returnType: node.returnType ? this.extractTypeAnnotation(node.returnType) : null,
          isAsync: node.async,
          isGenerator: node.generator,
          location: node.loc,
          body: this.analyzeFunctionBody(node.body),
          complexity: this.calculateFunctionComplexity(node),
          raw: node
        })
      } else if (node.type === 'MethodDefinition') {
        functions.push({
          name: node.key.name,
          type: 'method',
          kind: node.kind, // method, constructor, get, set
          params: node.value.params.map(param => this.extractParameter(param)),
          returnType: node.value.returnType ? this.extractTypeAnnotation(node.value.returnType) : null,
          isAsync: node.value.async,
          isStatic: node.static,
          location: node.loc,
          body: this.analyzeFunctionBody(node.value.body),
          complexity: this.calculateFunctionComplexity(node.value),
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(c => traverse(c, node))
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child, node)
        }
      }
    }

    traverse(ast)
    return functions
  }

  /**
   * Extract classes with all details
   */
  private extractClassesFromAST(ast: any): any[] {
    const classes: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'ClassDeclaration') {
        classes.push({
          name: node.id.name,
          superClass: node.superClass ? node.superClass.name : null,
          implements: node.implements?.map(impl => impl.expression.name) || [],
          methods: node.body.body.filter(member => member.type === 'MethodDefinition').map(method => ({
            name: method.key.name,
            kind: method.kind,
            isStatic: method.static,
            params: method.value.params.map(param => this.extractParameter(param)),
            location: method.loc
          })),
          properties: node.body.body.filter(member => member.type === 'PropertyDefinition').map(prop => ({
            name: prop.key.name,
            isStatic: prop.static,
            type: prop.typeAnnotation ? this.extractTypeAnnotation(prop.typeAnnotation) : null,
            location: prop.loc
          })),
          decorators: node.decorators?.map(dec => this.extractDecorator(dec)) || [],
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return classes
  }

    /**
   * Extract variables and constants
   */
  private extractVariablesFromAST(ast: any): any[] {
    const variables: any[] = []

    const traverse = (node: any) => {
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(declarator => {
          variables.push({
            name: declarator.id.name,
            kind: node.kind, // var, let, const
            type: declarator.id.typeAnnotation ? this.extractTypeAnnotation(declarator.id.typeAnnotation) : null,
            hasInitializer: !!declarator.init,
            initializerType: declarator.init?.type,
            location: declarator.loc,
            raw: declarator
          })
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return variables
  }

  /**
   * Extract TypeScript interfaces
   */
  private extractInterfacesFromAST(ast: any): any[] {
    const interfaces: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'TSInterfaceDeclaration') {
        interfaces.push({
          name: node.id.name,
          extends: node.extends?.map(ext => ext.expression.name) || [],
          properties: node.body.body.map(prop => ({
            name: prop.key.name,
            type: this.extractTypeAnnotation(prop.typeAnnotation),
            optional: prop.optional,
            readonly: prop.readonly,
            location: prop.loc
          })),
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return interfaces
  }

  /**
   * Extract TypeScript type aliases
   */
  private extractTypesFromAST(ast: any): any[] {
    const types: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'TSTypeAliasDeclaration') {
        types.push({
          name: node.id.name,
          typeAnnotation: this.extractTypeAnnotation(node.typeAnnotation),
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return types
  }

  /**
   * Extract TypeScript enums
   */
  private extractEnumsFromAST(ast: any): any[] {
    const enums: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'TSEnumDeclaration') {
        enums.push({
          name: node.id.name,
          members: node.members.map(member => ({
            name: member.id.name,
            value: member.initializer?.value,
            location: member.loc
          })),
          location: node.loc,
          raw: node
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return enums
  }

  /**
   * Extract decorators
   */
  private extractDecoratorsFromAST(ast: any): any[] {
    const decorators: any[] = []
    
    const traverse = (node: any) => {
      if (node.decorators) {
        node.decorators.forEach(decorator => {
          decorators.push(this.extractDecorator(decorator))
        })
      }

      // Traverse child nodes
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)
    return decorators
  }

  /**
   * Extract comments from AST and content
   */
  private extractCommentsFromAST(ast: any, content: string): any[] {
    const comments: any[] = []
    
    if (ast.comments) {
      ast.comments.forEach(comment => {
        comments.push({
          type: comment.type, // Line or Block
          value: comment.value.trim(),
          location: comment.loc,
          isJSDoc: comment.type === 'Block' && comment.value.startsWith('*')
        })
      })
    }

    return comments
  }

  /**
   * Create searchable content from AST
   */
  private extractSearchableContent(ast: any, content: string, filePath: string): any {
    return {
      filePath,
      allIdentifiers: this.getAllIdentifiers(ast),
      allStrings: this.getAllStringLiterals(ast),
      allComments: this.getAllComments(ast),
      codeStructure: this.getCodeStructure(ast),
      keywords: this.extractKeywords(ast),
      patterns: this.detectPatterns(ast)
    }
  }

  // Helper methods for detailed AST analysis
  private getDeclarationName(declaration: any): string | null {
    if (declaration.id) return declaration.id.name
    if (declaration.key) return declaration.key.name
    return null
  }

  private getFunctionName(node: any, parent?: any): string {
    if (node.id) return node.id.name
    if (parent?.type === 'VariableDeclarator') return parent.id.name
    if (parent?.type === 'Property') return parent.key.name
    return 'anonymous'
  }

  private extractParameter(param: any): any {
    return {
      name: param.name || (param.left?.name) || 'destructured',
      type: param.typeAnnotation ? this.extractTypeAnnotation(param.typeAnnotation) : null,
      optional: param.optional,
      default: param.right ? true : false
    }
  }

  private extractTypeAnnotation(typeAnnotation: any): string | null {
    if (!typeAnnotation) return null
    // Simplified type extraction - could be more comprehensive
    if (typeAnnotation.typeAnnotation) {
      return this.typeNodeToString(typeAnnotation.typeAnnotation)
    }
    return this.typeNodeToString(typeAnnotation)
  }

  private typeNodeToString(node: any): string {
    if (!node) return 'unknown'
    
    switch (node.type) {
      case 'TSStringKeyword': return 'string'
      case 'TSNumberKeyword': return 'number'
      case 'TSBooleanKeyword': return 'boolean'
      case 'TSVoidKeyword': return 'void'
      case 'TSAnyKeyword': return 'any'
      case 'TSUnknownKeyword': return 'unknown'
      case 'TSTypeReference': return node.typeName.name
      case 'TSArrayType': return `${this.typeNodeToString(node.elementType)}[]`
      case 'TSUnionType': return node.types.map(this.typeNodeToString.bind(this)).join(' | ')
      default: return node.type || 'unknown'
    }
  }

  private analyzeFunctionBody(body: any): any {
    return {
      type: body.type,
      statementCount: body.body?.length || 0,
      hasReturnStatement: this.hasReturnStatement(body),
      usesAsync: this.usesAsyncAwait(body)
    }
  }

  private calculateFunctionComplexity(node: any): number {
    let complexity = 1 // Base complexity
    
    const traverse = (n: any) => {
      if (['IfStatement', 'ConditionalExpression', 'SwitchCase', 
           'WhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(n.type)) {
        complexity++
      }
      
      for (const key in n) {
        const child = n[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(node)
    return complexity
  }

  private calculateComplexityFromAST(ast: any): number {
    let totalComplexity = 0
    
    const traverse = (node: any) => {
      if (['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) {
        totalComplexity += this.calculateFunctionComplexity(node)
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return totalComplexity
  }

  private extractDependenciesFromAST(ast: any): string[] {
    const dependencies = new Set<string>()
    
    const traverse = (node: any) => {
      if (node.type === 'ImportDeclaration') {
        dependencies.add(node.source.value)
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return Array.from(dependencies)
  }

  private createLocationMap(ast: any, content: string): any {
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

  private extractDecorator(decorator: any): any {
    return {
      name: decorator.expression.name || decorator.expression.callee?.name,
      arguments: decorator.expression.arguments?.map(arg => arg.value) || [],
      location: decorator.loc
    }
  }

  private getAllIdentifiers(ast: any): string[] {
    const identifiers = new Set<string>()
    
    const traverse = (node: any) => {
      if (node.type === 'Identifier') {
        identifiers.add(node.name)
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return Array.from(identifiers)
  }

  private getAllStringLiterals(ast: any): string[] {
    const strings: string[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'StringLiteral' || node.type === 'Literal' && typeof node.value === 'string') {
        strings.push(node.value)
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return strings
  }

  private getAllComments(ast: any): string[] {
    return ast.comments?.map(comment => comment.value.trim()) || []
  }

  private getCodeStructure(ast: any): any {
    const structure = {
      topLevelStatements: [],
      nestedDepth: 0
    }
    
    // Analyze top-level structure
    if (ast.body) {
      structure.topLevelStatements = ast.body.map(stmt => stmt.type)
    }
    
    return structure
  }

  private extractKeywords(ast: any): string[] {
    const keywords = new Set<string>()
    
    const traverse = (node: any) => {
      // Add node types as keywords for pattern matching
      if (node.type) {
        keywords.add(node.type)
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return Array.from(keywords)
  }

  private detectPatterns(ast: any): string[] {
    const patterns: string[] = []
    
    // Detect common patterns
    const traverse = (node: any) => {
      // React patterns
      if (node.type === 'JSXElement') patterns.push('jsx')
      if (node.type === 'CallExpression' && node.callee.name === 'useState') patterns.push('react-hooks')
      
      // Async patterns
      if (node.async) patterns.push('async-await')
      if (node.type === 'AwaitExpression') patterns.push('await')
      
      // Class patterns
      if (node.type === 'ClassDeclaration') patterns.push('class')
      if (node.type === 'MethodDefinition' && node.kind === 'constructor') patterns.push('constructor')
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return [...new Set(patterns)]
  }

  private hasReturnStatement(body: any): boolean {
    const traverse = (node: any): boolean => {
      if (node.type === 'ReturnStatement') return true
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          if (child.some(traverse)) return true
        } else if (child && typeof child === 'object' && child.type) {
          if (traverse(child)) return true
        }
      }
      return false
    }
    
    return traverse(body)
  }

  private usesAsyncAwait(body: any): boolean {
    const traverse = (node: any): boolean => {
      if (node.type === 'AwaitExpression') return true
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          if (child.some(traverse)) return true
        } else if (child && typeof child === 'object' && child.type) {
          if (traverse(child)) return true
        }
      }
      return false
    }
    
    return traverse(body)
  }

  /**
   * Extract call expressions (function calls, method calls)
   */
  private extractCallExpressions(ast: any): any[] {
    const calls: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'CallExpression') {
        calls.push({
          callee: this.getCalleeInfo(node.callee),
          arguments: node.arguments.map(arg => ({
            type: arg.type,
            value: arg.value || arg.name,
            location: arg.loc
          })),
          location: node.loc,
          isAsync: node.callee?.property?.name === 'then' || node.callee?.property?.name === 'catch'
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return calls
  }

  /**
   * Extract JSX elements and components
   */
  private extractJSXElements(ast: any): any[] {
    const jsx: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        jsx.push({
          type: node.type,
          name: node.openingElement?.name?.name || 'Fragment',
          attributes: node.openingElement?.attributes?.map(attr => ({
            name: attr.name?.name,
            value: attr.value?.value || attr.value?.expression?.value,
            location: attr.loc
          })) || [],
          children: node.children?.length || 0,
          location: node.loc,
          selfClosing: node.openingElement?.selfClosing
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return jsx
  }

  /**
   * Extract object patterns and destructuring
   */
  private extractObjectPatterns(ast: any): any[] {
    const patterns: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'ObjectPattern' || node.type === 'ArrayPattern') {
        patterns.push({
          type: node.type,
          properties: node.properties?.map(prop => ({
            key: prop.key?.name,
            value: prop.value?.name,
            computed: prop.computed,
            shorthand: prop.shorthand,
            location: prop.loc
          })) || [],
          elements: node.elements?.map(elem => elem?.name) || [],
          location: node.loc
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return patterns
  }

  /**
   * Extract conditional statements (if, switch, ternary)
   */
  private extractConditionals(ast: any): any[] {
    const conditionals: any[] = []
    
    const traverse = (node: any) => {
      if (['IfStatement', 'ConditionalExpression', 'SwitchStatement'].includes(node.type)) {
        conditionals.push({
          type: node.type,
          test: this.getExpressionInfo(node.test),
          consequent: node.consequent?.type,
          alternate: node.alternate?.type,
          cases: node.cases?.length || 0,
          location: node.loc,
          complexity: this.calculateBranchComplexity(node)
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return conditionals
  }

  /**
   * Extract loop statements (for, while, forEach)
   */
  private extractLoops(ast: any): any[] {
    const loops: any[] = []
    
    const traverse = (node: any) => {
      if (['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type)) {
        loops.push({
          type: node.type,
          init: node.init ? this.getExpressionInfo(node.init) : null,
          test: node.test ? this.getExpressionInfo(node.test) : null,
          update: node.update ? this.getExpressionInfo(node.update) : null,
          left: node.left ? this.getExpressionInfo(node.left) : null,
          right: node.right ? this.getExpressionInfo(node.right) : null,
          location: node.loc,
          bodyType: node.body?.type
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return loops
  }

  /**
   * Extract member expressions (object.property, object[key])
   */
  private extractMemberExpressions(ast: any): any[] {
    const members: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'MemberExpression') {
        members.push({
          object: node.object?.name || node.object?.type,
          property: node.property?.name || node.property?.value,
          computed: node.computed,
          optional: node.optional,
          location: node.loc,
          chain: this.getMemberChain(node)
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return members
  }

  /**
   * Extract all literal values
   */
  private extractLiterals(ast: any): any[] {
    const literals: any[] = []
    
    const traverse = (node: any) => {
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'RegExpLiteral', 'TemplateLiteral'].includes(node.type)) {
        literals.push({
          type: node.type,
          value: node.value,
          raw: node.raw,
          location: node.loc,
          // For template literals, extract expressions
          expressions: node.expressions?.map(expr => this.getExpressionInfo(expr)) || []
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return literals
  }

  /**
   * Extract assignment expressions
   */
  private extractAssignments(ast: any): any[] {
    const assignments: any[] = []
    
    const traverse = (node: any) => {
      if (node.type === 'AssignmentExpression') {
        assignments.push({
          operator: node.operator,
          left: this.getExpressionInfo(node.left),
          right: this.getExpressionInfo(node.right),
          location: node.loc
        })
      }
      
      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }
    
    traverse(ast)
    return assignments
  }

  // Helper methods for detailed extraction
  private getCalleeInfo(callee: any): any {
    if (!callee) return null
    
    return {
      type: callee.type,
      name: callee.name || callee.property?.name,
      object: callee.object?.name,
      property: callee.property?.name,
      computed: callee.computed
    }
  }

  private getExpressionInfo(expr: any): any {
    if (!expr) return null
    
    return {
      type: expr.type,
      name: expr.name,
      value: expr.value,
      operator: expr.operator,
      property: expr.property?.name
    }
  }

  private calculateBranchComplexity(node: any): number {
    let complexity = 1
    if (node.alternate) complexity += 1
    if (node.cases) complexity += node.cases.length
    return complexity
  }

  private getMemberChain(node: any): string {
    const parts: string[] = []
    
    const traverse = (n: any) => {
      if (n.type === 'MemberExpression') {
        traverse(n.object)
        parts.push(n.property?.name || `[${n.property?.value}]`)
      } else if (n.name) {
        parts.push(n.name)
      }
    }
    
    traverse(node)
    return parts.join('.')
  }

  // JSON Analysis Methods
  private analyzeJSONStructure(obj: any): any {
    return {
      type: Array.isArray(obj) ? 'array' : typeof obj,
      keys: typeof obj === 'object' && obj !== null ? Object.keys(obj) : [],
      length: Array.isArray(obj) ? obj.length : undefined,
      hasNestedObjects: this.hasNestedObjects(obj),
      hasArrays: this.hasArrays(obj)
    }
  }

  private extractJSONKeys(obj: any, prefix = ''): string[] {
    const keys: string[] = []
    
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        keys.push(fullKey)
        
        if (typeof value === 'object' && value !== null) {
          keys.push(...this.extractJSONKeys(value, fullKey))
        }
      }
    }
    
    return keys
  }

  private calculateJSONDepth(obj: any): number {
    if (obj === null || typeof obj !== 'object') return 0
    
    let maxDepth = 0
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        maxDepth = Math.max(maxDepth, this.calculateJSONDepth(value))
      }
    }
    
    return maxDepth + 1
  }

  private inferJSONSchema(obj: any): any {
    if (obj === null) return { type: 'null' }
    if (Array.isArray(obj)) {
      return {
        type: 'array',
        items: obj.length > 0 ? this.inferJSONSchema(obj[0]) : { type: 'unknown' }
      }
    }
    if (typeof obj === 'object') {
      const properties = {}
      for (const [key, value] of Object.entries(obj)) {
        properties[key] = this.inferJSONSchema(value)
      }
      return { type: 'object', properties }
    }
    
    return { type: typeof obj }
  }

  private extractJSONSearchableContent(obj: any, filePath: string): any {
    return {
      filePath,
      keys: this.extractJSONKeys(obj),
      values: this.extractJSONValues(obj),
      paths: this.extractJSONPaths(obj),
      schema: this.inferJSONSchema(obj)
    }
  }

  private extractJSONValues(obj: any): any[] {
    const values: any[] = []
    
    const traverse = (value: any) => {
      if (Array.isArray(value)) {
        value.forEach(traverse)
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(traverse)
      } else {
        values.push(value)
      }
    }
    
    traverse(obj)
    return values
  }

  private extractJSONPaths(obj: any, currentPath = ''): string[] {
    const paths: string[] = []
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const newPath = `${currentPath}[${index}]`
        paths.push(newPath)
        paths.push(...this.extractJSONPaths(item, newPath))
      })
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        const newPath = currentPath ? `${currentPath}.${key}` : key
        paths.push(newPath)
        paths.push(...this.extractJSONPaths(value, newPath))
      })
    }
    
    return paths
  }

  private hasNestedObjects(obj: any): boolean {
    if (Array.isArray(obj)) {
      return obj.some(item => typeof item === 'object' && item !== null)
    }
    if (obj && typeof obj === 'object') {
      return Object.values(obj).some(value => typeof value === 'object' && value !== null)
    }
    return false
  }

  private hasArrays(obj: any): boolean {
    if (obj && typeof obj === 'object') {
      return Object.values(obj).some(value => Array.isArray(value))
    }
    return false
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