# Repository Analysis and Search System

## Table of Contents
1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Tech Stack](#tech-stack)
4. [Phase 1: Repository Analysis & Storage](#phase-1-repository-analysis--storage)
5. [Phase 2: Intelligent Search Chatbot](#phase-2-intelligent-search-chatbot)
6. [Implementation Details](#implementation-details)
7. [Constraints & Restrictions](#constraints--restrictions)
8. [Database Schema](#database-schema)
9. [API Endpoints](#api-endpoints)
10. [Deployment Guide](#deployment-guide)

## Project Overview

The Repository Analysis and Search System is a comprehensive solution designed to analyze code repositories, extract detailed structural information, and provide intelligent search capabilities through a chatbot interface. The system focuses on Next.js and NestJS codebases, enabling developers to quickly find implementations, understand patterns, and discover code relationships across multiple repositories.

### Key Features
- **Automated Repository Analysis**: Deep analysis of repository structure, features, and implementations
- **Comprehensive AST Generation**: Detailed Abstract Syntax Tree extraction for JavaScript, TypeScript, and JSON files
- **Intelligent Search**: Natural language query processing with contextual code snippet extraction
- **Multi-Repository Support**: Analyze and search across multiple repositories simultaneously
- **Pattern Recognition**: Automatic detection of common frameworks, libraries, and coding patterns

## System Architecture

```mermaid
graph TB
    A[User Interface] --> B[Repository Selection]
    B --> C[GitHub API Integration]
    C --> D[Repository Analysis Engine]
    D --> E[AST Generator]
    D --> F[Feature Extractor]
    D --> G[Structure Analyzer]
    E --> H[Database Storage]
    F --> H
    G --> H
    H --> I[Search Engine]
    I --> J[LLM Processing]
    J --> K[Code Snippet Extractor]
    K --> L[Chatbot Interface]
```

## Tech Stack

### Frontend
- **Next.js 14**: React framework with App Router for the user interface
- **shadcn/ui**: UI component library for consistent design
- **TailwindCSS**: Utility-first CSS framework for styling
- **TypeScript**: Type-safe development

### Backend
- **NestJS**: Scalable Node.js server-side framework
- **Prisma ORM**: Type-safe database access layer
- **MongoDB**: Document-based database for flexible data storage
- **TypeScript**: End-to-end type safety

### AI & Processing
- **Vercel AI SDK**: Integration with language models
- **@babel/parser**: JavaScript/TypeScript AST parsing
- **Claude 3.5 Sonnet**: LLM for natural language processing and code analysis

### Infrastructure
- **GitHub API**: Repository data fetching
- **Vercel**: Deployment platform
- **Environment Variables**: Secure configuration management

## Phase 1: Repository Analysis & Storage

### 1.1 User Interface for Repository Selection

#### Internal Access Setup
```typescript
// Configuration for internal use
const GITHUB_CONFIG = {
  personalAccessToken: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  allowedOrganizations: ['your-org', 'another-org'],
  supportedLanguages: ['TypeScript', 'JavaScript', 'JSON'],
  supportedFrameworks: ['Next.js', 'NestJS', 'React']
}
```

#### Repository Selection Flow
1. **Authentication**: Use personal access token for GitHub API access
2. **Repository Listing**: Fetch all accessible repositories from specified organizations
3. **Filtering**: Filter repositories by language and framework detection
4. **Selection Interface**: Multi-select UI for repository selection
5. **Analysis Queue**: Queue selected repositories for processing

#### UI Components
```typescript
// Repository selection interface
interface RepositorySelectionProps {
  repositories: GitHubRepository[]
  selectedRepos: string[]
  onSelectionChange: (repoIds: string[]) => void
  onAnalyzeSelected: () => void
}

// Repository card component
interface RepositoryCardProps {
  repository: GitHubRepository
  isSelected: boolean
  onToggle: (repoId: string) => void
  analysisStatus?: 'pending' | 'in_progress' | 'completed' | 'failed'
}
```

### 1.2 GitHub Repository Data Fetching

#### Step 1: Repository Tree Fetching
```typescript
async getRepositoryTree(owner: string, repo: string): Promise<GitHubTree[]> {
  const response = await this.github.rest.git.getTree({
    owner,
    repo,
    tree_sha: 'HEAD',
    recursive: true
  })
  
  return response.data.tree.map(item => ({
    path: item.path,
    type: item.type, // 'blob' | 'tree'
    size: item.size,
    sha: item.sha,
    url: item.url
  }))
}
```

#### Step 2: Important Files Identification
```typescript
private getImportantFiles(tree: GitHubTree[]): string[] {
  // Priority-based file selection
  const highPriorityPatterns = [
    // Configuration files (Priority: 1.0)
    /^package\.json$/, /^tsconfig\.json$/, /^next\.config\./,
    /^nest-cli\.json$/, /^prisma\/schema\.prisma$/,
    
    // Entry points (Priority: 0.9)
    /^src\/main\.ts$/, /^src\/app\.ts$/, /^app\/layout\.tsx$/,
    /^pages\/_app\.tsx$/, /^pages\/index\.tsx$/,
    
    // API routes (Priority: 0.8)
    /\/api\//, /\.controller\.ts$/, /\.service\.ts$/,
    
    // Documentation (Priority: 0.7)
    /README\./i, /CONTRIBUTING\./i, /CHANGELOG\./i
  ]
  
  const mediumPriorityPatterns = [
    // Source code files (Priority: 0.6)
    /\.(ts|tsx|js|jsx)$/, /\.json$/
  ]
  
  // Filter and prioritize files
  const files = tree.filter(item => item.type === 'blob')
  const prioritizedFiles = this.prioritizeFiles(files, highPriorityPatterns, mediumPriorityPatterns)
  
  // Limit to prevent API rate limiting
  return prioritizedFiles.slice(0, 100).map(f => f.path)
}
```

#### Step 3: File Content Retrieval
```typescript
async getMultipleFilesContent(
  owner: string, 
  repo: string, 
  filePaths: string[]
): Promise<Array<{ path: string; content: string | null }>> {
  const batchSize = 10 // Prevent rate limiting
  const results = []
  
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize)
    const batchPromises = batch.map(async (path) => {
      try {
        const content = await this.getFileContent(owner, repo, path)
        return { path, content }
      } catch (error) {
        this.logger.warn(`Failed to fetch ${path}: ${error.message}`)
        return { path, content: null }
      }
    })
    
    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
    
    // Rate limiting delay
    if (i + batchSize < filePaths.length) {
      await this.delay(1000) // 1 second delay between batches
    }
  }
  
  return results
}
```

### 1.3 Repository Metadata Extraction

#### README Content Processing
```typescript
async getReadmeContent(owner: string, repo: string): Promise<string | null> {
  const readmePatterns = ['README.md', 'README.rst', 'README.txt', 'readme.md']
  
  for (const pattern of readmePatterns) {
    try {
      const content = await this.getFileContent(owner, repo, pattern)
      if (content) {
        return content
      }
    } catch (error) {
      continue // Try next pattern
    }
  }
  
  return null
}
```

#### Repository Statistics
```typescript
async getRepositoryStats(owner: string, repo: string): Promise<RepositoryStats> {
  const [repoData, languages, contributors] = await Promise.all([
    this.github.rest.repos.get({ owner, repo }),
    this.github.rest.repos.listLanguages({ owner, repo }),
    this.github.rest.repos.listContributors({ owner, repo, per_page: 100 })
  ])
  
  return {
    stars: repoData.data.stargazers_count,
    forks: repoData.data.forks_count,
    size: repoData.data.size,
    languages: languages.data,
    contributors: contributors.data.length,
    lastCommit: repoData.data.pushed_at,
    createdAt: repoData.data.created_at,
    updatedAt: repoData.data.updated_at,
    defaultBranch: repoData.data.default_branch,
    topics: repoData.data.topics || []
  }
}
```

### 1.4 Feature Extraction with LLM

#### LLM-Powered Feature Analysis
```typescript
private async extractFeatures(
  fileContents: Array<{ path: string; content: string | null }>,
  readmeContent: string | null
): Promise<RepositoryFeature[]> {
  
  const codeContext = fileContents
    .filter(f => f.content)
    .slice(0, 20) // Limit context size
    .map(f => `File: ${f.path}\n${f.content}`)
    .join('\n\n---\n\n')

  const prompt = `Analyze this repository and identify all features and functionalities implemented.

README Content:
${readmeContent || 'No README available'}

Code Files:
${codeContext}

Identify features in these categories:
- Authentication & Authorization (JWT, OAuth, session management)
- API Development (REST endpoints, GraphQL, middleware)
- Database Operations (ORM usage, queries, migrations)
- Frontend Components (React components, pages, layouts)
- State Management (Redux, Zustand, Context API)
- File Handling (uploads, processing, storage)
- Real-time Features (WebSockets, SSE, notifications)
- Third-party Integrations (payment, email, cloud services)
- Testing (unit tests, integration tests, E2E)
- DevOps & Deployment (Docker, CI/CD, monitoring)

For each feature, provide:
- name: Clear, descriptive feature name
- description: What the feature does and how it works
- files: Key files that implement this feature
- type: Category from the list above
- implementation: Technical implementation details
- dependencies: Required packages, libraries, or external services

Return as JSON object with features array.`

  const result = await this.llmService.generate<{ features: RepositoryFeature[] }>({
    messages: [
      { 
        role: 'system', 
        content: 'You are an expert software architect analyzing code repositories. Extract features systematically and provide detailed technical insights.' 
      },
      { role: 'user', content: prompt }
    ],
    responseFormat: 'json',
    modelConfig: {
      model: 'anthropic',
      name: 'claude-3-5-sonnet-20241022',
    },
    schema: RepositoryFeaturesSchema
  })

  return result.features
}
```

### 1.5 Structure Analysis

#### Architectural Pattern Detection
```typescript
private async analyzeStructure(
  tree: GitHubTree[],
  fileContents: Array<{ path: string; content: string | null }>
): Promise<RepositoryStructure> {
  
  const directories = [...new Set(tree.map(item => item.path.split('/')[0]))]
    .filter(dir => dir !== '' && !dir.startsWith('.'))
    .slice(0, 20)

  const structurePrompt = `Analyze this repository structure and provide architectural insights:

Directory Structure:
${directories.join('\n')}

Key Files:
${fileContents.filter(f => f.content).slice(0, 10).map(f => f.path).join('\n')}

Sample Code Context:
${fileContents.filter(f => f.content).slice(0, 5).map(f => 
  `${f.path}:\n${f.content?.substring(0, 500)}`
).join('\n\n')}

Analyze and identify:
1. Overall architecture pattern (MVC, Clean Architecture, Microservices, Monolith, JAMstack)
2. Design patterns used (Repository, Factory, Observer, Middleware, etc.)
3. Directory structure and organization
4. Application entry points
5. Configuration management approach

Provide detailed analysis in JSON format:
{
  "architecture": "detailed architecture description with reasoning",
  "patterns": ["list of design patterns with explanations"],
  "directories": [
    {
      "path": "directory name",
      "purpose": "detailed purpose and contents",
      "importance": 1-10 (importance score)
    }
  ],
  "entryPoints": ["main application entry files with descriptions"],
  "configFiles": ["configuration files and their purposes"],
  "layering": {
    "presentation": ["UI/presentation layer files"],
    "business": ["business logic files"],
    "data": ["data access layer files"],
    "infrastructure": ["infrastructure and external concerns"]
  }
}`

  return await this.llmService.generate<RepositoryStructure>({
    messages: [
      { 
        role: 'system', 
        content: 'You are an expert software architect. Analyze repository structure and identify architectural patterns, design decisions, and code organization principles.' 
      },
      { role: 'user', content: structurePrompt }
    ],
    responseFormat: 'json',
    modelConfig: {
      model: 'anthropic',
      name: 'claude-3-5-sonnet-20241022',
    },
    schema: RepositoryStructureSchema
  })
}
```

### 1.6 Technology Stack Analysis

#### Comprehensive Tech Stack Detection
```typescript
private async extractTechStack(
  fileContents: Array<{ path: string; content: string | null }>,
  languages: Record<string, number>
): Promise<TechStack> {
  
  // Extract package files for dependency analysis
  const packageFiles = fileContents.filter(f => 
    ['package.json', 'requirements.txt', 'Gemfile', 'composer.json', 'pom.xml', 'Cargo.toml']
      .some(pattern => f.path.includes(pattern))
  )

  const configFiles = fileContents.filter(f => 
    ['config', '.env', 'docker', 'webpack', 'vite', 'tailwind', 'eslint', 'prettier']
      .some(pattern => f.path.toLowerCase().includes(pattern))
  )

  const techStackPrompt = `Analyze the technology stack of this repository:

Languages (by code volume):
${Object.entries(languages).map(([lang, bytes]) => `${lang}: ${bytes} bytes`).join('\n')}

Package/Dependency Files:
${packageFiles.map(f => `${f.path}:\n${f.content}`).join('\n\n')}

Configuration Files:
${configFiles.map(f => `${f.path}:\n${f.content?.substring(0, 1000)}`).join('\n\n')}

Categorize all technologies and provide detailed analysis:

{
  "frontend": {
    "frameworks": ["main frontend frameworks"],
    "libraries": ["UI libraries, component libraries"],
    "styling": ["CSS frameworks, styling solutions"],
    "stateManagement": ["state management libraries"],
    "routing": ["routing solutions"]
  },
  "backend": {
    "frameworks": ["server frameworks"],
    "databases": ["database technologies"],
    "orm": ["ORM/ODM tools"],
    "authentication": ["auth libraries and methods"],
    "apis": ["API technologies (REST, GraphQL, etc.)"]
  },
  "devtools": {
    "bundlers": ["build tools and bundlers"],
    "testing": ["testing frameworks and tools"],
    "linting": ["code quality tools"],
    "cicd": ["CI/CD and deployment tools"],
    "monitoring": ["logging and monitoring tools"]
  },
  "infrastructure": {
    "containerization": ["Docker, Kubernetes, etc."],
    "cloud": ["cloud services and platforms"],
    "storage": ["file storage solutions"],
    "caching": ["caching solutions"]
  },
  "languages": ["programming languages used"],
  "patterns": ["architectural patterns detected"],
  "compatibility": {
    "nodeVersion": "Node.js version requirements",
    "browserSupport": "browser compatibility info"
  }
}`

  return await this.llmService.generate<TechStack>({
    messages: [
      { 
        role: 'system', 
        content: 'You are a technology stack analyst. Identify and categorize all technologies, frameworks, libraries, and tools used in the codebase.' 
      },
      { role: 'user', content: techStackPrompt }
    ],
    responseFormat: 'json',
    modelConfig: {
      model: 'anthropic',
      name: 'claude-3-5-sonnet-20241022',
    },
    schema: TechStackSchema
  })
}
```

### 1.7 Comprehensive AST Generation

#### Multi-Language AST Processing
```typescript
private async generateAST(
  fileContents: Array<{ path: string; content: string | null }>
): Promise<ComprehensiveAST> {
  
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
      dbOperations: [] as any[]
    }
  }

  for (const file of fileContents) {
    if (!file.content) continue

    const language = this.detectLanguage(file.path)
    if (!['javascript', 'typescript', 'json'].includes(language)) continue

    try {
      const fileAst = await this.parseFileAST(file.path, file.content, language)
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
        
        // Analyze global patterns
        this.analyzeGlobalPatterns(cleanedAst, astData.globalPatterns)
      }
    } catch (error) {
      this.logger.warn(`Failed to parse AST for ${file.path}: ${error.message}`)
      continue
    }
  }

  // Convert Set to Array for JSON serialization
  astData.summary.languages = Array.from(astData.summary.languages) as any

  return astData
}
```

#### Detailed AST File Processing
```typescript
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

private async parseJSTypeScriptAST(filePath: string, content: string, language: string): Promise<any> {
  try {
    const babel = await import('@babel/parser')
    
    const plugins = [
      'jsx', 'decorators-legacy', 'classProperties', 'objectRestSpread',
      'asyncGenerators', 'functionBind', 'exportDefaultFrom', 'exportNamespaceFrom',
      'dynamicImport', 'nullishCoalescingOperator', 'optionalChaining',
      'optionalCatchBinding', 'throwExpressions', 'topLevelAwait'
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
      
      // Core AST extractions (cleaned of raw AST nodes)
      imports: this.extractImportsFromAST(ast),
      exports: this.extractExportsFromAST(ast),
      functions: this.extractFunctionsFromAST(ast),
      classes: this.extractClassesFromAST(ast),
      variables: this.extractVariablesFromAST(ast),
      interfaces: language === 'typescript' ? this.extractInterfacesFromAST(ast) : [],
      types: language === 'typescript' ? this.extractTypesFromAST(ast) : [],
      enums: language === 'typescript' ? this.extractEnumsFromAST(ast) : [],
      decorators: this.extractDecoratorsFromAST(ast),
      comments: this.extractCommentsFromAST(ast, content),
      
      // Advanced code pattern extractions
      callExpressions: this.extractCallExpressions(ast),
      jsxElements: this.extractJSXElements(ast),
      objectPatterns: this.extractObjectPatterns(ast),
      conditionals: this.extractConditionals(ast),
      loops: this.extractLoops(ast),
      memberExpressions: this.extractMemberExpressions(ast),
      literals: this.extractLiterals(ast),
      assignments: this.extractAssignments(ast),
      
      // Searchable content for efficient querying
      searchableContent: this.extractSearchableContent(ast, content, filePath),
      
      // Code quality metrics
      complexity: this.calculateComplexityFromAST(ast),
      dependencies: this.extractDependenciesFromAST(ast),
      
      // Location mapping for precise code navigation
      locationMap: this.createLocationMap(ast, content)
    }
  } catch (error) {
    throw new Error(`Failed to parse ${language} AST for ${filePath}: ${error.message}`)
  }
}
```

### 1.8 Database Storage

#### Analysis Data Storage
```typescript
async storeAnalysisResults(
  repositoryId: string,
  analysisData: {
    features: RepositoryFeature[],
    structure: RepositoryStructure,
    techStack: TechStack,
    astData: ComprehensiveAST,
    codeMetrics: CodeMetrics,
    summary: string
  }
): Promise<void> {
  
  await this.prisma.analysis.create({
    data: {
      repositoryId,
      status: AnalysisStatus.COMPLETED,
      completedAt: new Date(),
      
      // Core analysis results
      features: analysisData.features as any,
      structure: analysisData.structure as any,
      techStack: analysisData.techStack as any,
      astData: analysisData.astData as any,
      codeMetrics: analysisData.codeMetrics as any,
      
      // Searchable content for efficient querying
      searchableContent: this.createSearchableContent(
        analysisData.features, 
        analysisData.structure, 
        analysisData.astData
      ),
      
      // Generated summary and metadata
      summary: analysisData.summary,
      complexity: analysisData.codeMetrics.complexity,
      dependencies: analysisData.techStack.languages,
      
      // Documentation and README
      documentation: { 
        readme: analysisData.structure.readme || null,
        apiDocs: this.extractAPIDocumentation(analysisData.astData)
      }
    }
  })
  
  // Update repository last analyzed timestamp
  await this.prisma.repository.update({
    where: { id: repositoryId },
    data: { lastAnalyzed: new Date() }
  })
}
```

## Phase 2: Intelligent Search Chatbot

### 2.1 Natural Language Query Processing

#### Query Understanding with LLM
```typescript
async parseSearchQuery(query: string): Promise<SearchContext> {
  const queryAnalysisPrompt = `Analyze this code search query and extract structured information:

Query: "${query}"

Extract and return JSON with:
{
  "intent": "find|implement|understand|debug|learn|compare",
  "searchType": "function|class|component|hook|api|pattern|feature|library|configuration",
  "primaryTechnology": "main technology/framework being searched (e.g., 'next-auth', 'prisma', 'react')",
  "keywords": ["relevant search terms and synonyms"],
  "codePatterns": ["specific code patterns to look for"],
  "filePatterns": ["likely file names or paths"],
  "contextClues": ["additional context that helps narrow the search"],
  "complexity": "basic|intermediate|advanced",
  "expectedResults": {
    "resultTypes": ["config|implementation|usage|documentation"],
    "fileTypes": ["expected file extensions"],
    "frameworks": ["relevant frameworks"]
  },
  "searchScope": "specific-files|directory|entire-codebase",
  "priority": {
    "exactMatches": 0.9,
    "patternMatches": 0.7,
    "contextualMatches": 0.5
  }
}

Consider these common search patterns:
- Authentication: JWT, OAuth, sessions, login, signup, middleware
- Database: ORM, queries, migrations, models, schemas
- API: endpoints, routes, controllers, middleware, validation
- Frontend: components, hooks, state management, routing
- Configuration: environment variables, config files, settings`

  const result = await this.llmService.generate<SearchContext>({
    messages: [
      {
        role: 'system',
        content: 'You are an expert code search assistant. Analyze queries and extract structured search parameters to help find relevant code implementations.'
      },
      { role: 'user', content: queryAnalysisPrompt }
    ],
    responseFormat: 'json',
    modelConfig: {
      model: 'anthropic',
      name: 'claude-3-5-sonnet-20241022',
    }
  })

  return {
    originalQuery: query,
    ...result,
    searchTerms: this.extractSearchTerms(query),
    timestamp: new Date()
  }
}
```

### 2.2 Dynamic Pattern Generation

#### LLM-Generated Search Patterns
```typescript
async generateSearchPatterns(searchContext: SearchContext): Promise<SearchPatterns> {
  const patternGenerationPrompt = `Generate comprehensive search patterns for finding "${searchContext.primaryTechnology}" implementations:

Technology: ${searchContext.primaryTechnology}
Search Type: ${searchContext.searchType}
Context: ${searchContext.contextClues.join(', ')}

Generate specific patterns to identify:

1. Import/Export Patterns:
   - Package imports and specific function imports
   - Common export patterns and naming conventions

2. Function Call Patterns:
   - Main API calls and method invocations
   - Configuration and setup patterns
   - Usage patterns in different contexts

3. Code Structure Patterns:
   - File naming conventions
   - Directory structure indicators
   - Configuration file patterns

4. Implementation Patterns:
   - Common implementation approaches
   - Integration patterns with other libraries
   - Error handling and edge cases

Return JSON with specific patterns:
{
  "importPatterns": [
    {
      "pattern": "specific import pattern",
      "description": "what this import indicates",
      "score": 0.0-1.0,
      "context": "where this is typically found"
    }
  ],
  "callPatterns": [
    {
      "pattern": "function/method call pattern",
      "description": "what this call does",
      "score": 0.0-1.0,
      "astSection": "callExpressions|memberExpressions"
    }
  ],
  "structurePatterns": [
    {
      "pattern": "file/directory pattern",
      "description": "structural indicator",
      "score": 0.0-1.0,
      "location": "file path or structure pattern"
    }
  ],
  "codePatterns": [
    {
      "pattern": "code implementation pattern",
      "description": "what this pattern achieves",
      "score": 0.0-1.0,
      "astSection": "functions|classes|variables|interfaces"
    }
  ],
  "contextualPatterns": [
    {
      "pattern": "contextual indicator",
      "description": "contextual meaning",
      "score": 0.0-1.0,
      "scope": "file|project|ecosystem"
    }
  ]
}`

  return await this.llmService.generate<SearchPatterns>({
    messages: [
      {
        role: 'system',
        content: `You are an expert in code pattern recognition. Generate comprehensive search patterns that can identify implementations of specific technologies in codebases.`
      },
      { role: 'user', content: patternGenerationPrompt }
    ],
    responseFormat: 'json',
    modelConfig: {
      model: 'anthropic',
      name: 'claude-3-5-sonnet-20241022',
    }
  })
}
```

### 2.3 Generic Match Scoring System

#### Universal Match Score Calculator
```typescript
calculateMatchScore(
  astItem: any, 
  searchContext: SearchContext, 
  searchPatterns: SearchPatterns
): MatchScore {
  
  let totalScore = 0
  const matchDetails = {
    importMatches: [],
    callMatches: [],
    structureMatches: [],
    codeMatches: [],
    contextualMatches: [],
    keywordMatches: []
  }

  const itemText = JSON.stringify(astItem).toLowerCase()
  
  // 1. Import Pattern Matching
  if (searchPatterns.importPatterns && astItem.source) {
    for (const pattern of searchPatterns.importPatterns) {
      if (this.matchesPattern(astItem, pattern.pattern)) {
        totalScore += pattern.score * 0.9 // High weight for import matches
        matchDetails.importMatches.push(pattern)
      }
    }
  }

  // 2. Function Call Pattern Matching
  if (searchPatterns.callPatterns && astItem.callee) {
    for (const pattern of searchPatterns.callPatterns) {
      if (this.matchesCallPattern(astItem, pattern.pattern)) {
        totalScore += pattern.score * 0.8 // High weight for call matches
        matchDetails.callMatches.push(pattern)
      }
    }
  }

  // 3. Code Implementation Pattern Matching
  if (searchPatterns.codePatterns) {
    for (const pattern of searchPatterns.codePatterns) {
      if (this.matchesCodePattern(astItem, pattern.pattern)) {
        totalScore += pattern.score * 0.7
        matchDetails.codeMatches.push(pattern)
      }
    }
  }

  // 4. Keyword Matching
  for (const keyword of searchContext.keywords) {
    if (itemText.includes(keyword.toLowerCase())) {
      totalScore += 0.3
      matchDetails.keywordMatches.push(keyword)
    }
  }

  // 5. Context Pattern Matching
  if (searchPatterns.contextualPatterns) {
    for (const pattern of searchPatterns.contextualPatterns) {
      if (this.matchesContextualPattern(astItem, pattern.pattern)) {
        totalScore += pattern.score * 0.5
        matchDetails.contextualMatches.push(pattern)
      }
    }
  }

  // 6. Boost for exact name matches
  if (astItem.name && searchContext.searchTerms.includes(astItem.name.toLowerCase())) {
    totalScore += 0.4
  }

  // 7. Boost for location relevance
  if (astItem.location && this.isInRelevantLocation(astItem.location, searchContext)) {
    totalScore += 0.2
  }

  return {
    score: Math.min(totalScore, 1.0), // Cap at 1.0
    confidence: this.calculateConfidence(totalScore, matchDetails),
    matchDetails,
    explanationFactors: this.generateExplanationFactors(matchDetails)
  }
}

// Pattern matching helper methods
private matchesPattern(astItem: any, pattern: string): boolean {
  const itemStr = JSON.stringify(astItem)
  
  // Support different pattern types
  if (pattern.startsWith('regex:')) {
    const regex = new RegExp(pattern.substring(6), 'i')
    return regex.test(itemStr)
  }
  
  if (pattern.startsWith('exact:')) {
    return itemStr.includes(pattern.substring(6))
  }
  
  // Default: flexible string matching
  return itemStr.toLowerCase().includes(pattern.toLowerCase())
}

private matchesCallPattern(astItem: any, pattern: string): boolean {
  if (!astItem.callee) return false
  
  const calleeName = astItem.callee.name || astItem.callee.property?.name
  if (!calleeName) return false
  
  // Support various call pattern formats
  return pattern.split('|').some(p => 
    calleeName.toLowerCase().includes(p.toLowerCase())
  )
}

private matchesCodePattern(astItem: any, pattern: string): boolean {
  // Match against various AST node properties
  const searchableProperties = [
    astItem.name, astItem.type, astItem.kind, 
    astItem.declarationType, astItem.returnType
  ].filter(Boolean).join(' ').toLowerCase()
  
  return searchableProperties.includes(pattern.toLowerCase())
}
```

### 2.4 Database Query Optimization

#### Efficient AST Data Querying
```typescript
async queryASTData(searchContext: SearchContext, repositoryId?: string): Promise<SearchResult[]> {
  const whereClause: any = {
    status: 'COMPLETED',
    astData: { not: null }
  }
  
  if (repositoryId) {
    whereClause.repositoryId = repositoryId
  }

  // Pre-filter repositories based on tech stack if possible
  if (searchContext.expectedResults.frameworks.length > 0) {
    whereClause.OR = searchContext.expectedResults.frameworks.map(framework => ({
      techStack: {
        path: ['frontend', 'frameworks'],
        array_contains: framework
      }
    }))
  }

  const analyses = await this.prisma.analysis.findMany({
    where: whereClause,
    select: {
      id: true,
      repositoryId: true,
      astData: true,
      techStack: true,
      features: true,
      repository: {
        select: {
          fullName: true,
          url: true,
          description: true
        }
      }
    },
    // Limit results to prevent memory issues
    take: 50
  })

  const results = []
  
  // Generate search patterns dynamically
  const searchPatterns = await this.generateSearchPatterns(searchContext)
  
  for (const analysis of analyses) {
    const astData = analysis.astData as any
    if (!astData?.files) continue

    // Pre-filter files based on expected file types
    const relevantFiles = astData.files.filter(file => 
      this.isRelevantFile(file, searchContext)
    )

    for (const file of relevantFiles) {
      const matches = await this.searchInFileAST(file, searchContext, searchPatterns)
      
      if (matches.length > 0) {
        results.push(...matches.map(match => ({
          ...match,
          analysisId: analysis.id,
          repositoryId: analysis.repositoryId,
          repositoryName: analysis.repository.fullName,
          repositoryUrl: analysis.repository.url,
          repositoryDescription: analysis.repository.description,
          filePath: file.path,
          language: file.language,
          techStack: analysis.techStack,
          features: analysis.features
        })))
      }
    }
  }

  return results.sort((a, b) => b.matchScore.score - a.matchScore.score)
}
```

### 2.5 Advanced File-Level Search

#### Comprehensive AST Section Search
```typescript
async searchInFileAST(
  fileAST: any, 
  searchContext: SearchContext, 
  searchPatterns: SearchPatterns
): Promise<FileSearchResult[]> {
  
  const matches = []
  
  // Determine which AST sections to search based on search type
  const searchSections = this.getSearchSections(searchContext.searchType)
  
  for (const section of searchSections) {
    if (!fileAST[section] || !Array.isArray(fileAST[section])) continue

    const sectionMatches = await this.searchInSection(
      fileAST[section], 
      section, 
      searchContext,
      searchPatterns
    )

    matches.push(...sectionMatches.map(match => ({
      ...match,
      section,
      matchType: searchContext.searchType,
      fileRelevanceScore: this.calculateFileRelevance(fileAST.path, searchContext)
    })))
  }

  // Filter matches by minimum relevance threshold
  return matches.filter(match => match.matchScore.score > 0.3)
}

async searchInSection(
  sectionData: any[], 
  sectionType: string, 
  searchContext: SearchContext,
  searchPatterns: SearchPatterns
): Promise<SectionSearchResult[]> {
  
  const matches = []

  for (const item of sectionData) {
    const matchScore = this.calculateMatchScore(item, searchContext, searchPatterns)
    
    if (matchScore.score > 0.3) {
      matches.push({
        astItem: item,
        matchScore,
        sectionType,
        relevanceFactors: this.extractRelevanceFactors(item, searchContext),
        codeContext: this.extractCodeContext(item, sectionType)
      })
    }
  }

  return matches.sort((a, b) => b.matchScore.score - a.matchScore.score)
}
```

### 2.6 Contextual Code Snippet Extraction

#### Smart Code Snippet Generation
```typescript
async extractCodeSnippets(searchResults: SearchResult[]): Promise<CodeSnippet[]> {
  const snippets = []

  for (const result of searchResults) {
    try {
      // Get actual file content from GitHub
      const [owner, repoName] = result.repositoryName.split('/')
      const fileContent = await this.githubService.getFileContent(
        owner, 
        repoName, 
        result.filePath
      )

      if (fileContent) {
        const snippet = await this.generateSmartSnippet(
          fileContent, 
          result.astItem.location,
          result.matchScore.matchDetails,
          result.sectionType,
          result.repositoryName
        )
        
        snippets.push({
          ...snippet,
          resultId: result.id,
          explanation: await this.generateSnippetExplanation(result, snippet),
          relevanceScore: result.matchScore.score,
          matchType: result.matchType
        })
      }
    } catch (error) {
      this.logger.error(`Failed to extract snippet for ${result.filePath}: ${error.message}`)
      
      // Provide fallback snippet
      snippets.push({
        code: '// Code snippet unavailable - file may have been moved or deleted',
        language: result.language,
        startLine: 0,
        endLine: 0,
        filePath: result.filePath,
        explanation: 'Unable to retrieve current file content',
        relevanceScore: result.matchScore.score,
        matchType: result.matchType
      })
    }
  }

  return snippets
}

async generateSmartSnippet(
  fileContent: string, 
  location: any, 
  matchDetails: any,
  sectionType: string,
  repositoryName: string
): Promise<SnippetData> {
  
  const lines = fileContent.split('\n')
  
  if (!location?.start?.line || !location?.end?.line) {
    // Fallback: find content based on match details
    return this.extractSnippetByPatterns(lines, matchDetails, sectionType)
  }

  // Context sizes based on section type and complexity
  const contextSizes = {
    'functions': { before: 5, after: 5 },
    'classes': { before: 3, after: 8 },
    'interfaces': { before: 2, after: 5 },
    'callExpressions': { before: 3, after: 2 },
    'imports': { before: 0, after: 2 },
    'exports': { before: 2, after: 0 },
    'jsxElements': { before: 2, after: 3 },
    'variables': { before: 1, after: 3 }
  }

  const context = contextSizes[sectionType] || { before: 3, after: 3 }
  
  const startLine = Math.max(0, location.start.line - 1 - context.before)
  const endLine = Math.min(lines.length - 1, location.end.line - 1 + context.after)

  // Extract snippet with line numbers and highlighting
  const snippetLines = lines.slice(startLine, endLine + 1)
  const formattedSnippet = snippetLines
    .map((line, index) => {
      const lineNumber = startLine + index + 1
      const isMainLine = lineNumber >= location.start.line && lineNumber <= location.end.line
      const prefix = isMainLine ? '→ ' : '  '
      
      // Highlight matched terms
      let highlightedLine = this.highlightMatchedTerms(line, matchDetails)
      
      return `${lineNumber.toString().padStart(3)}${prefix}${highlightedLine}`
    })
    .join('\n')

  return {
    code: formattedSnippet,
    language: this.getLanguageFromPath(location.filePath || ''),
    startLine: startLine + 1,
    endLine: endLine + 1,
    filePath: location.filePath || '',
    repository: repositoryName,
    contextType: sectionType,
    hasHighlighting: true
  }
}
```

### 2.7 Intelligent Result Ranking

#### Multi-Factor Ranking System
```typescript
async rankSearchResults(
  results: SearchResult[], 
  searchContext: SearchContext
): Promise<RankedSearchResult[]> {
  
  const rankedResults = results.map(result => {
    const rankingFactors = {
      // Core match quality (40%)
      matchScore: result.matchScore.score * 0.4,
      
      // Repository quality (25%)
      repositoryScore: this.calculateRepositoryScore(result) * 0.25,
      
      // File relevance (15%)
      fileRelevance: result.fileRelevanceScore * 0.15,
      
      // Recency and maintenance (10%)
      recencyScore: this.calculateRecencyScore(result) * 0.1,
      
      // User context alignment (10%)
      contextAlignment: this.calculateContextAlignment(result, searchContext) * 0.1
    }

    const finalScore = Object.values(rankingFactors).reduce((sum, score) => sum + score, 0)

    return {
      ...result,
      finalScore,
      rankingFactors,
      confidence: this.calculateOverallConfidence(rankingFactors),
      recommendationReason: this.generateRecommendationReason(rankingFactors, result)
    }
  })

  return rankedResults
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 20) // Top 20 results
}

private calculateRepositoryScore(result: SearchResult): number {
  let score = 0.5 // Base score
  
  // Boost for popular patterns in tech stack
  const popularTechnologies = ['React', 'Next.js', 'TypeScript', 'Node.js', 'NestJS']
  const repoTech = result.techStack?.languages || []
  const popularityBoost = popularTechnologies.filter(tech => 
    repoTech.some(t => t.toLowerCase().includes(tech.toLowerCase()))
  ).length * 0.1
  
  score += popularityBoost
  
  // Boost for feature richness
  const featureCount = result.features?.length || 0
  score += Math.min(featureCount * 0.02, 0.3) // Cap at 0.3
  
  // Boost for good documentation
  if (result.repositoryDescription && result.repositoryDescription.length > 50) {
    score += 0.1
  }
  
  return Math.min(score, 1.0)
}

private calculateContextAlignment(result: SearchResult, searchContext: SearchContext): number {
  let alignment = 0.5
  
  // Check if result aligns with expected frameworks
  const expectedFrameworks = searchContext.expectedResults.frameworks
  const resultTech = result.techStack
  
  if (expectedFrameworks.length > 0 && resultTech) {
    const matches = expectedFrameworks.filter(framework =>
      JSON.stringify(resultTech).toLowerCase().includes(framework.toLowerCase())
    )
    alignment += (matches.length / expectedFrameworks.length) * 0.4
  }
  
  // Check file type alignment
  const expectedFileTypes = searchContext.expectedResults.fileTypes
  if (expectedFileTypes.includes(result.language)) {
    alignment += 0.1
  }
  
  return Math.min(alignment, 1.0)
}
```

### 2.8 Response Generation and Explanation

#### LLM-Powered Result Explanations
```typescript
async generateExplanations(
  rankedResults: RankedSearchResult[], 
  searchContext: SearchContext
): Promise<string[]> {
  
  const explanations = []
  
  for (const result of rankedResults) {
    try {
      const explanationPrompt = `Explain how this code result relates to the search query:

Original Query: "${searchContext.originalQuery}"
Search Intent: ${searchContext.intent}
Primary Technology: ${searchContext.primaryTechnology}

Result Details:
- File: ${result.filePath}
- Repository: ${result.repositoryName}
- Section Type: ${result.sectionType} 
- Match Score: ${result.matchScore.score.toFixed(2)}
- Technologies: ${result.techStack?.languages?.join(', ') || 'Unknown'}

Match Details:
${JSON.stringify(result.matchScore.matchDetails, null, 2)}

Code Context:
${result.codeContext || 'No additional context available'}

Provide a clear, concise explanation (2-3 sentences) that:
1. Explains what this code does in relation to the search query
2. Highlights why it's relevant and useful
3. Mentions any notable implementation details or patterns

Keep the explanation technical but accessible, focusing on practical value.`

      const explanation = await this.llmService.generate<string>({
        messages: [
          {
            role: 'system',
            content: 'You are a code explanation expert. Provide clear, technical explanations of how code results relate to search queries.'
          },
          { role: 'user', content: explanationPrompt }
        ],
        responseFormat: 'string',
        modelConfig: {
          model: 'anthropic',
          name: 'claude-3-5-sonnet-20241022',
        }
      })

      explanations.push(explanation)
      
    } catch (error) {
      this.logger.error(`Failed to generate explanation: ${error.message}`)
      
      // Fallback explanation
      explanations.push(
        `This ${result.sectionType} in ${result.filePath} matches your search for "${searchContext.primaryTechnology}". ` +
        `It shows ${result.matchType} implementation with a relevance score of ${result.matchScore.score.toFixed(2)}.`
      )
    }
  }

  return explanations
}
```

### 2.9 Complete Search Response Assembly

#### Final Search Result Assembly
```typescript
async executeSearch(query: string, repositoryId?: string): Promise<SearchResponse> {
  const startTime = Date.now()
  
  try {
    // Step 1: Parse and understand the query
    const searchContext = await this.parseSearchQuery(query)
    
    // Step 2: Query AST data from database
    const searchResults = await this.queryASTData(searchContext, repositoryId)
    
    if (searchResults.length === 0) {
      return {
        query,
        searchContext,
        totalMatches: 0,
        results: [],
        suggestions: await this.generateSearchSuggestions(searchContext),
        processingTime: Date.now() - startTime
      }
    }
    
    // Step 3: Rank and filter results
    const rankedResults = await this.rankSearchResults(searchResults, searchContext)
    
    // Step 4: Extract code snippets with context
    const codeSnippets = await this.extractCodeSnippets(rankedResults)
    
    // Step 5: Generate explanations
    const explanations = await this.generateExplanations(rankedResults, searchContext)
    
    // Step 6: Assemble final response
    const finalResults = rankedResults.map((result, index) => ({
      id: `result_${index + 1}`,
      repository: {
        name: result.repositoryName,
        url: result.repositoryUrl,
        description: result.repositoryDescription
      },
      file: {
        path: result.filePath,
        language: result.language,
        section: result.sectionType
      },
      match: {
        type: result.matchType,
        score: result.matchScore.score,
        confidence: result.confidence,
        details: result.matchScore.matchDetails
      },
      code: codeSnippets[index],
      explanation: explanations[index],
      ranking: {
        position: index + 1,
        finalScore: result.finalScore,
        factors: result.rankingFactors
      },
      metadata: {
        techStack: result.techStack,
        features: result.features?.slice(0, 3), // Top 3 relevant features
        complexity: result.astItem?.complexity || 'unknown'
      }
    }))

    return {
      query,
      searchContext,
      totalMatches: searchResults.length,
      results: finalResults,
      summary: {
        topRepositories: this.getTopRepositories(finalResults),
        commonPatterns: this.extractCommonPatterns(finalResults),
        suggestedNextSteps: await this.generateNextSteps(searchContext, finalResults)
      },
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }
    
  } catch (error) {
    this.logger.error(`Search execution failed: ${error.message}`)
    throw new Error(`Search failed: ${error.message}`)
  }
}
```

## Example: Next-Auth Implementation Search

### Query: "fetch all the implementation of next-auth in a code base"

#### Step 1: Query Analysis
```json
{
  "originalQuery": "fetch all the implementation of next-auth in a code base",
  "intent": "find",
  "searchType": "authentication",
  "primaryTechnology": "next-auth",
  "keywords": ["next-auth", "nextauth", "authentication", "auth", "session"],
  "codePatterns": ["NextAuth", "useSession", "signIn", "signOut", "getServerSession"],
  "filePatterns": ["[...nextauth]", "auth.ts", "middleware.ts"],
  "contextClues": ["implementation", "codebase", "authentication system"],
  "expectedResults": {
    "resultTypes": ["config", "implementation", "usage"],
    "fileTypes": ["ts", "tsx", "js", "jsx"],
    "frameworks": ["Next.js", "React"]
  }
}
```

#### Step 2: Dynamic Pattern Generation
```json
{
  "importPatterns": [
    {
      "pattern": "next-auth",
      "description": "Main NextAuth import",
      "score": 0.95,
      "context": "Configuration files and API routes"
    },
    {
      "pattern": "next-auth/react",
      "description": "Client-side NextAuth hooks",
      "score": 0.9,
      "context": "React components using authentication"
    }
  ],
  "callPatterns": [
    {
      "pattern": "NextAuth",
      "description": "NextAuth configuration call",
      "score": 0.95,
      "astSection": "callExpressions"
    },
    {
      "pattern": "useSession|getSession|getServerSession",
      "description": "Session management functions",
      "score": 0.85,
      "astSection": "callExpressions"
    }
  ],
  "structurePatterns": [
    {
      "pattern": "[...nextauth]",
      "description": "NextAuth API route structure",
      "score": 0.9,
      "location": "app/api/auth or pages/api/auth"
    }
  ]
}
```

#### Step 3: Search Results
```json
{
  "query": "fetch all the implementation of next-auth in a code base",
  "totalMatches": 8,
  "results": [
    {
      "id": "result_1",
      "repository": {
        "name": "company/webapp",
        "url": "https://github.com/company/webapp"
      },
      "file": {
        "path": "app/api/auth/[...nextauth]/route.ts",
        "language": "typescript",
        "section": "exports"
      },
      "match": {
        "type": "authentication",
        "score": 0.95,
        "confidence": 0.92,
        "details": {
          "importMatches": ["next-auth", "GoogleProvider", "CredentialsProvider"],
          "callMatches": ["NextAuth"],
          "structureMatches": ["[...nextauth]"]
        }
      },
      "code": {
        "snippet": "```typescript\n 15→ import NextAuth from 'next-auth'\n 16→ import GoogleProvider from 'next-auth/providers/google'\n 17→ \n 18→ const authOptions = {\n 19→   providers: [\n 20→     GoogleProvider({\n 21→       clientId: process.env.GOOGLE_CLIENT_ID!,\n 22→       clientSecret: process.env.GOOGLE_CLIENT_SECRET!\n 23→     })\n 24→   ],\n 25→   callbacks: {\n 26→     async jwt({ token, user }) {\n 27→       if (user) token.id = user.id\n 28→       return token\n 29→     }\n 30→   }\n 31→ }\n 32→ \n 33→ **const handler = NextAuth(authOptions)**\n 34→ export { handler as GET, handler as POST }\n```",
        "language": "typescript",
        "startLine": 15,
        "endLine": 34
      },
      "explanation": "This is the main NextAuth.js configuration file that sets up authentication providers (Google OAuth) and session handling. It defines the core authentication logic including JWT callbacks and exports the handler for both GET and POST requests to handle the authentication flow.",
      "ranking": {
        "position": 1,
        "finalScore": 0.89,
        "factors": {
          "matchScore": 0.38,
          "repositoryScore": 0.22,
          "fileRelevance": 0.14,
          "recencyScore": 0.08,
          "contextAlignment": 0.09
        }
      }
    }
  ]
}
```

## Constraints & Restrictions

### 1. Technical Constraints

#### File Processing Limits
- **Maximum files per repository**: 100 important files
- **File size limit**: 5MB per file
- **Total processing time**: 10 minutes per repository
- **AST parsing timeout**: 30 seconds per file

#### API Rate Limits
- **GitHub API**: 5000 requests/hour (authenticated)
- **Batch processing**: 10 files per batch with 1-second delays
- **LLM requests**: Rate limited based on provider (Claude: 1000 requests/minute)

#### Database Constraints
- **AST data size**: Maximum 16MB per document (MongoDB limit)
- **Search result limit**: Top 20 results per query
- **Repository limit**: 50 repositories per search operation

### 2. Language and Framework Support

#### Supported Languages
- **Primary**: TypeScript, JavaScript, JSON
- **File types**: .ts, .tsx, .js, .jsx, .json
- **Future support**: Python, Go (planned)

#### Supported Frameworks
- **Frontend**: Next.js, React, Vue.js (limited)
- **Backend**: NestJS, Express.js
- **Full-stack**: Next.js applications with API routes

### 3. Search Limitations

#### Query Complexity
- **Maximum query length**: 500 characters
- **Processing timeout**: 30 seconds per search
- **Pattern generation**: Limited to 50 patterns per query

#### Result Quality
- **Minimum relevance score**: 0.3 for inclusion
- **Code snippet size**: Maximum 50 lines with context
- **Explanation length**: 2-3 sentences per result

### 4. Security and Access

#### Repository Access
- **Internal use only**: Personal access token required
- **Organization restrictions**: Limited to specified GitHub organizations
- **Private repository access**: Based on token permissions

#### Data Security
- **No code storage**: Only AST metadata stored, not raw code
- **Access logs**: All search queries logged for analysis
- **Token security**: Environment variable storage required

## Database Schema

### Core Tables

```prisma
model Repository {
  id          String   @id @default(cuid())
  fullName    String   @unique // owner/repo-name
  url         String
  description String?
  language    String?
  stars       Int      @default(0)
  forks       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  lastAnalyzed DateTime?
  
  analyses    Analysis[]
  
  @@map("repositories")
}

model Analysis {
  id            String          @id @default(cuid())
  repositoryId  String
  status        AnalysisStatus
  startedAt     DateTime        @default(now())
  completedAt   DateTime?
  errorMessage  String?
  
  // Core analysis results
  features         Json? // RepositoryFeature[]
  structure        Json? // RepositoryStructure
  techStack        Json? // TechStack
  astData          Json? // ComprehensiveAST
  codeMetrics      Json? // CodeMetrics
  
  // Search optimization
  searchableContent Json? // Flattened searchable data
  summary          String?
  complexity       String? // 'low' | 'medium' | 'high'
  dependencies     String[] // Main languages/frameworks
  
  // Documentation
  documentation    Json? // README and API docs
  
  repository       Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  
  @@map("analyses")
}

enum AnalysisStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
}
```

### Search Analytics

```prisma
model SearchQuery {
  id              String   @id @default(cuid())
  query           String
  userId          String?
  searchContext   Json     // Parsed search context
  results         Json     // Search results metadata
  processingTime  Int      // Milliseconds
  createdAt       DateTime @default(now())
  
  @@map("search_queries")
}
```

## API Endpoints

### Repository Management

```typescript
// Get available repositories
GET /api/repositories
Response: Repository[]

// Add repository for analysis
POST /api/repositories
Body: { fullName: string, priority?: 'high' | 'medium' | 'low' }
Response: { repositoryId: string, status: 'queued' }

// Get repository analysis status
GET /api/repositories/:id/analysis
Response: { status: AnalysisStatus, progress?: number, results?: Analysis }

// Trigger repository re-analysis
POST /api/repositories/:id/analyze
Response: { status: 'started', analysisId: string }
```

### Search Interface

```typescript
// Execute search query
POST /api/search
Body: { 
  query: string, 
  repositoryId?: string, 
  options?: {
    maxResults?: number,
    includeCodeSnippets?: boolean,
    searchScope?: 'all' | 'specific-repo'
  }
}
Response: SearchResponse

// Get search suggestions
GET /api/search/suggestions?q=:query
Response: { suggestions: string[], categories: string[] }

// Get search history
GET /api/search/history
Response: { queries: SearchQuery[], totalCount: number }
```

### Analysis Data

```typescript
// Get AST data for specific file
GET /api/analysis/:analysisId/ast?filePath=:path
Response: { astData: FileAST, metadata: FileMetadata }

// Get repository features
GET /api/analysis/:analysisId/features
Response: { features: RepositoryFeature[], summary: string }

// Get tech stack analysis
GET /api/analysis/:analysisId/techstack
Response: { techStack: TechStack, confidence: number }
```

## Deployment Guide

### Environment Setup

```bash
# Backend environment variables
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx
DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/synapsis
CLAUDE_API_KEY=sk-ant-xxx
NEXTAUTH_SECRET=xxx
NEXTAUTH_URL=http://localhost:3000

# Frontend environment variables
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

### Development Setup

```bash
# Backend setup
cd server
pnpm install
npx prisma generate
pnpm start:dev

# Frontend setup
cd web
pnpm install
pnpm dev
```

### Production Deployment

```bash
# Build backend
cd server
pnpm build
pnpm start:prod

# Build frontend
cd web
pnpm build
pnpm start
```

### Infrastructure Requirements

- **MongoDB Atlas**: M10+ cluster for production
- **Vercel**: Frontend deployment with Edge Functions
- **Railway/Heroku**: Backend API deployment
- **GitHub**: Repository access and authentication
- **Claude API**: LLM processing and analysis

This comprehensive system provides intelligent code analysis and search capabilities, enabling developers to quickly discover implementations, understand patterns, and learn from existing codebases across multiple repositories. 