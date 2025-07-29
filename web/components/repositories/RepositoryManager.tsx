'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { 
  Loader2, 
  GitBranch, 
  Star, 
  GitFork, 
  Calendar, 
  Play, 
  CheckCircle, 
  XCircle, 
  Clock,
  Search,
  RefreshCw
} from 'lucide-react'

interface Repository {
  id: string
  name: string
  fullName: string
  owner: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  githubUrl: string
  lastAnalyzed: string | null
  analyses: Array<{
    id: string
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    startedAt: string
    completedAt: string | null
    errorMessage: string | null
    summary?: string
  }>
}

interface GitHubRepository {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  html_url: string
}

interface AnalysisProgress {
  step: number
  totalSteps: number
  message: string
  repositoryId: string
  repositoryName: string
}

export default function RepositoryManager() {
  const [gitHubRepos, setGitHubRepos] = useState<GitHubRepository[]>([])
  const [localRepos, setLocalRepos] = useState<Repository[]>([])
  const [loadingGitHub, setLoadingGitHub] = useState(false)
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [analyzingRepos, setAnalyzingRepos] = useState<Set<string>>(new Set())
  const [analysisProgress, setAnalysisProgress] = useState<Map<string, AnalysisProgress>>(new Map())
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'github' | 'local'>('github')

  // Load GitHub repositories
  const loadGitHubRepos = async () => {
    setLoadingGitHub(true)
    try {
      const response = await fetch('http://localhost:3001/repositories')
      const data = await response.json()
      setGitHubRepos(data)
    } catch (error) {
      console.error('Failed to load GitHub repositories:', error)
    } finally {
      setLoadingGitHub(false)
    }
  }

  // Load local repositories
  const loadLocalRepos = async () => {
    setLoadingLocal(true)
    try {
      const response = await fetch('http://localhost:3001/repositories/local')
      const data = await response.json()
      setLocalRepos(data)
    } catch (error) {
      console.error('Failed to load local repositories:', error)
    } finally {
      setLoadingLocal(false)
    }
  }

  // Save repository to local database
  const saveRepository = async (owner: string, repo: string) => {
    try {
      const response = await fetch('http://localhost:3001/repositories/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo })
      })
      
      if (response.ok) {
        await loadLocalRepos() // Refresh local repos
      }
    } catch (error) {
      console.error('Failed to save repository:', error)
    }
  }

  // Start repository analysis
  const startAnalysis = async (repositoryId: string) => {
    setAnalyzingRepos(prev => new Set([...prev, repositoryId]))
    
    try {
      const response = await fetch(`http://localhost:3001/repositories/${repositoryId}/analyze`, {
        method: 'POST'
      })
      
      if (response.ok) {
        // Start listening to analysis progress via SSE
        await startAnalysisStream(repositoryId)
      }
    } catch (error) {
      console.error('Failed to start analysis:', error)
      setAnalyzingRepos(prev => {
        const newSet = new Set(prev)
        newSet.delete(repositoryId)
        return newSet
      })
    }
  }

  // Stream analysis progress
  const startAnalysisStream = async (repositoryId: string) => {
    try {
      const eventSource = new EventSource(
        `http://localhost:3001/repositories/${repositoryId}/analyze/stream`
      )

      eventSource.addEventListener('status', (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        setAnalysisProgress(prev => new Map(prev.set(repositoryId, data)))
      })

      eventSource.addEventListener('complete', (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        console.log('Analysis completed:', data)
        
        setAnalyzingRepos(prev => {
          const newSet = new Set(prev)
          newSet.delete(repositoryId)
          return newSet
        })
        
        setAnalysisProgress(prev => {
          const newMap = new Map(prev)
          newMap.delete(repositoryId)
          return newMap
        })
        
        // Refresh local repos to show updated analysis
        loadLocalRepos()
        eventSource.close()
      })

      eventSource.addEventListener('error', (event: MessageEvent) => {
        try {
          // Try to parse JSON data if it exists
          const data = event.data ? JSON.parse(event.data) : { message: 'Unknown error occurred' }
          console.error('Analysis error:', data)
        } catch (parseError) {
          // Handle case where event.data is not valid JSON
          console.error('Analysis error (invalid JSON):', event.data || 'No error data provided')
        }
        
        setAnalyzingRepos(prev => {
          const newSet = new Set(prev)
          newSet.delete(repositoryId)
          return newSet
        })
        
        setAnalysisProgress(prev => {
          const newMap = new Map(prev)
          newMap.delete(repositoryId)
          return newMap
        })
        
        eventSource.close()
      })

      eventSource.onerror = (error) => {
        const eventSourceTarget = error.target as EventSource
        console.error('SSE connection error:', {
          type: error.type || 'unknown',
          readyState: eventSourceTarget?.readyState || 'unknown',
          message: 'EventSource connection failed'
        })
        
        // Clean up state when connection fails
        setAnalyzingRepos(prev => {
          const newSet = new Set(prev)
          newSet.delete(repositoryId)
          return newSet
        })
        
        setAnalysisProgress(prev => {
          const newMap = new Map(prev)
          newMap.delete(repositoryId)
          return newMap
        })
        
        eventSource.close()
      }
    } catch (error) {
      console.error('Failed to start analysis stream:', error)
    }
  }

  useEffect(() => {
    if (activeTab === 'github') {
      loadGitHubRepos()
    } else {
      loadLocalRepos()
    }
  }, [activeTab])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'FAILED': return <XCircle className="w-4 h-4 text-red-600" />
      case 'IN_PROGRESS': return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
      case 'PENDING': return <Clock className="w-4 h-4 text-yellow-600" />
      default: return null
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      case 'FAILED': return 'bg-red-100 text-red-800'
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800'
      case 'PENDING': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const filteredGitHubRepos = gitHubRepos.filter(repo =>
    repo.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredLocalRepos = localRepos.filter(repo =>
    repo.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Repository Manager
          </CardTitle>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-gray-100 rounded-lg p-1">
              <Button
                variant={activeTab === 'github' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('github')}
              >
                GitHub Repositories
              </Button>
              <Button
                variant={activeTab === 'local' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('local')}
              >
                Analyzed Repositories
              </Button>
            </div>
            
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search repositories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={activeTab === 'github' ? loadGitHubRepos : loadLocalRepos}
              disabled={loadingGitHub || loadingLocal}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {activeTab === 'github' && (
            <div className="space-y-4">
              {loadingGitHub ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="ml-2">Loading GitHub repositories...</span>
                </div>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-3">
                    {filteredGitHubRepos.map((repo) => (
                      <Card key={repo.id} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h3 className="font-medium text-lg">{repo.full_name}</h3>
                              <p className="text-sm text-gray-600 mt-1">{repo.description}</p>
                              
                              <div className="flex items-center gap-4 mt-2">
                                {repo.language && (
                                  <Badge variant="outline">{repo.language}</Badge>
                                )}
                                <div className="flex items-center gap-1 text-sm text-gray-500">
                                  <Star className="w-4 h-4" />
                                  <span>{repo.stargazers_count}</span>
                                </div>
                                <div className="flex items-center gap-1 text-sm text-gray-500">
                                  <GitFork className="w-4 h-4" />
                                  <span>{repo.forks_count}</span>
                                </div>
                              </div>
                            </div>
                            
                            <Button
                              size="sm"
                              onClick={() => saveRepository(repo.owner.login, repo.name)}
                            >
                              Add for Analysis
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {activeTab === 'local' && (
            <div className="space-y-4">
              {loadingLocal ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="ml-2">Loading analyzed repositories...</span>
                </div>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-3">
                    {filteredLocalRepos.map((repo) => {
                      const latestAnalysis = repo.analyses[0]
                      const isAnalyzing = analyzingRepos.has(repo.id)
                      const progress = analysisProgress.get(repo.id)
                      
                      return (
                        <Card key={repo.id} className="border">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-medium text-lg">{repo.fullName}</h3>
                                <p className="text-sm text-gray-600 mt-1">{repo.description}</p>
                                
                                <div className="flex items-center gap-4 mt-2">
                                  {repo.language && (
                                    <Badge variant="outline">{repo.language}</Badge>
                                  )}
                                  <div className="flex items-center gap-1 text-sm text-gray-500">
                                    <Star className="w-4 h-4" />
                                    <span>{repo.stars}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-sm text-gray-500">
                                    <GitFork className="w-4 h-4" />
                                    <span>{repo.forks}</span>
                                  </div>
                                  {repo.lastAnalyzed && (
                                    <div className="flex items-center gap-1 text-sm text-gray-500">
                                      <Calendar className="w-4 h-4" />
                                      <span>
                                        {new Date(repo.lastAnalyzed).toLocaleDateString()}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {latestAnalysis && (
                                  <div className="mt-3">
                                    <div className="flex items-center gap-2">
                                      {getStatusIcon(latestAnalysis.status)}
                                      <Badge className={getStatusColor(latestAnalysis.status)}>
                                        {latestAnalysis.status}
                                      </Badge>
                                      {latestAnalysis.completedAt && (
                                        <span className="text-xs text-gray-500">
                                          {new Date(latestAnalysis.completedAt).toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                    
                                    {latestAnalysis.summary && (
                                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                                        {latestAnalysis.summary}
                                      </p>
                                    )}
                                    
                                    {latestAnalysis.errorMessage && (
                                      <p className="text-sm text-red-600 mt-2">
                                        Error: {latestAnalysis.errorMessage}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {progress && (
                                  <div className="mt-3">
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      <span>{progress.message}</span>
                                      <span>({progress.step}/{progress.totalSteps})</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                                      <div 
                                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => startAnalysis(repo.id)}
                                  disabled={isAnalyzing || (latestAnalysis?.status === 'IN_PROGRESS')}
                                >
                                  {isAnalyzing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Play className="w-4 h-4" />
                                  )}
                                  {latestAnalysis ? 'Re-analyze' : 'Analyze'}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
} 