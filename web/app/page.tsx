'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Search, GitBranch, Star, GitFork, Eye, ExternalLink, Loader2 } from 'lucide-react'
import { RepositoriesService, GitHubRepository, Repository, Analysis } from '@/services/repositories.service'
import { toast } from 'sonner'

export default function Home() {
  const [gitHubRepos, setGitHubRepos] = useState<GitHubRepository[]>([])
  const [localRepos, setLocalRepos] = useState<Repository[]>([])
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [organization, setOrganization] = useState('')

  useEffect(() => {
    loadLocalRepositories()
  }, [])

  const loadGitHubRepositories = async () => {
    setLoading(true)
    try {
      const response = await RepositoriesService.getGitHubRepositories(organization || undefined)
      if (response.data) {
        setGitHubRepos(response.data)
        toast.success(`Loaded ${response.data.length} repositories from GitHub`)
      } else {
        toast.error('Failed to load GitHub repositories')
      }
    } catch (error) {
      console.error('Error loading GitHub repos:', error)
      toast.error('Failed to load GitHub repositories')
    } finally {
      setLoading(false)
    }
  }

  const loadLocalRepositories = async () => {
    try {
      const response = await RepositoriesService.getLocalRepositories()
      if (response.data) {
        setLocalRepos(response.data)
      }
    } catch (error) {
      console.error('Error loading local repos:', error)
    }
  }

  const saveRepository = async (githubRepo: GitHubRepository) => {
    setLoading(true)
    try {
      const response = await RepositoriesService.saveRepository(
        githubRepo.owner.login, 
        githubRepo.name
      )
      if (response.data) {
        toast.success(`Repository ${githubRepo.full_name} saved successfully`)
        await loadLocalRepositories()
      } else {
        toast.error('Failed to save repository')
      }
    } catch (error) {
      console.error('Error saving repository:', error)
      toast.error('Failed to save repository')
    } finally {
      setLoading(false)
    }
  }

  const analyzeRepository = async (repo: Repository) => {
    setAnalyzing(true)
    try {
      const response = await RepositoriesService.analyzeRepository(repo.id)
      if (response.data) {
        toast.success('Analysis started successfully')
        setSelectedRepo(repo)
        
        // Poll for analysis completion
        pollAnalysisStatus(repo.id)
      } else {
        toast.error('Failed to start analysis')
      }
    } catch (error) {
      console.error('Error starting analysis:', error)
      toast.error('Failed to start analysis')
    } finally {
      setAnalyzing(false)
    }
  }

  const pollAnalysisStatus = async (repositoryId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await RepositoriesService.getAnalysisStatus(repositoryId)
        if (statusResponse.data) {
          const { status } = statusResponse.data
          
          if (status === 'COMPLETED') {
            clearInterval(pollInterval)
            const analysisResponse = await RepositoriesService.getRepositoryAnalysis(repositoryId)
            if (analysisResponse.data) {
              setAnalysis(analysisResponse.data)
              toast.success('Analysis completed successfully!')
            }
          } else if (status === 'FAILED') {
            clearInterval(pollInterval)
            toast.error('Analysis failed')
          }
        }
      } catch (error) {
        console.error('Error polling analysis status:', error)
      }
    }, 5000) // Poll every 5 seconds

    // Stop polling after 10 minutes
    setTimeout(() => clearInterval(pollInterval), 600000)
  }

  const viewAnalysis = async (repo: Repository) => {
    setLoading(true)
    try {
      const response = await RepositoriesService.getRepositoryAnalysis(repo.id)
      if (response.data) {
        setSelectedRepo(repo)
        setAnalysis(response.data)
      } else {
        toast.error('No analysis found for this repository')
      }
    } catch (error) {
      console.error('Error loading analysis:', error)
      toast.error('Failed to load analysis')
    } finally {
      setLoading(false)
    }
  }

  const filteredGitHubRepos = gitHubRepos.filter(repo =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const filteredLocalRepos = localRepos.filter(repo =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">GitHub Documentation Creator</h1>
        <p className="text-muted-foreground text-lg">
          Analyze GitHub repositories to extract features, understand architecture, and generate searchable documentation.
        </p>
      </div>

      {!selectedRepo ? (
        <Tabs defaultValue="github" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="github">GitHub Repositories</TabsTrigger>
            <TabsTrigger value="local">Saved Repositories</TabsTrigger>
          </TabsList>

          <TabsContent value="github" className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">Organization (optional)</label>
                <Input
                  placeholder="Enter GitHub organization name"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                />
              </div>
              <Button onClick={loadGitHubRepositories} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Loading...
                  </>
                ) : (
                  'Load Repositories'
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              <Input
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-md"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredGitHubRepos.map((repo) => (
                <Card key={repo.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{repo.name}</CardTitle>
                        <CardDescription className="text-sm">
                          {repo.owner.login}
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(repo.html_url, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {repo.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {repo.description}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {repo.stargazers_count}
                      </div>
                      <div className="flex items-center gap-1">
                        <GitFork className="w-3 h-3" />
                        {repo.forks_count}
                      </div>
                      {repo.language && (
                        <Badge variant="secondary" className="text-xs">
                          {repo.language}
                        </Badge>
                      )}
                    </div>

                    <Button 
                      onClick={() => saveRepository(repo)} 
                      disabled={loading}
                      className="w-full"
                    >
                      Save Repository
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="local" className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              <Input
                placeholder="Search saved repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-md"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredLocalRepos.map((repo) => {
                const latestAnalysis = repo.analyses?.[0]
                const hasAnalysis = latestAnalysis?.status === 'COMPLETED'
                
                return (
                  <Card key={repo.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-lg">{repo.name}</CardTitle>
                          <CardDescription className="text-sm">
                            {repo.owner}
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => window.open(repo.githubUrl, '_blank')}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {repo.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {repo.description}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3" />
                          {repo.stars}
                        </div>
                        <div className="flex items-center gap-1">
                          <GitFork className="w-3 h-3" />
                          {repo.forks}
                        </div>
                        {repo.language && (
                          <Badge variant="secondary" className="text-xs">
                            {repo.language}
                          </Badge>
                        )}
                      </div>

                      {latestAnalysis && (
                        <Badge 
                          variant={
                            latestAnalysis.status === 'COMPLETED' ? 'default' :
                            latestAnalysis.status === 'IN_PROGRESS' ? 'secondary' :
                            latestAnalysis.status === 'FAILED' ? 'destructive' : 'outline'
                          }
                          className="text-xs"
                        >
                          {latestAnalysis.status.replace('_', ' ')}
                        </Badge>
                      )}

                      <div className="flex gap-2">
                        {hasAnalysis ? (
                          <Button 
                            onClick={() => viewAnalysis(repo)} 
                            disabled={loading}
                            className="flex-1"
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            View Analysis
                          </Button>
                        ) : (
                          <Button 
                            onClick={() => analyzeRepository(repo)} 
                            disabled={analyzing}
                            className="flex-1"
                          >
                            {analyzing ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Analyzing...
                              </>
                            ) : (
                              <>
                                <GitBranch className="w-4 h-4 mr-2" />
                                Analyze
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedRepo(null)
                setAnalysis(null)
              }}
            >
              ← Back to Repositories
            </Button>
            <div>
              <h2 className="text-2xl font-bold">{selectedRepo.name}</h2>
              <p className="text-muted-foreground">{selectedRepo.fullName}</p>
            </div>
          </div>

          {analysis ? (
            <div className="space-y-6">
              {/* Analysis results will be shown here */}
              <Card>
                <CardHeader>
                  <CardTitle>Repository Analysis</CardTitle>
                  <CardDescription>
                    Analysis completed on {new Date(analysis.completedAt!).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose max-w-none">
                    <h3>Summary</h3>
                    <p>{analysis.summary}</p>
                    
                    {analysis.features && analysis.features.length > 0 && (
                      <>
                        <h3>Features ({analysis.features.length})</h3>
                        <div className="grid gap-3 md:grid-cols-2">
                          {analysis.features.map((feature, index) => (
                            <div key={index} className="border rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline">{feature.type}</Badge>
                                <h4 className="font-semibold text-sm">{feature.name}</h4>
                              </div>
                              <p className="text-xs text-muted-foreground">{feature.description}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {analysis.techStack && (
                      <>
                        <h3>Technology Stack</h3>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(analysis.techStack).map(([category, technologies]) => (
                            <div key={category} className="space-y-2">
                              <h4 className="font-semibold capitalize">{category}</h4>
                              <div className="flex flex-wrap gap-1">
                                {Array.isArray(technologies) ? technologies.map((tech) => (
                                  <Badge key={tech} variant="secondary" className="text-xs">
                                    {tech}
                                  </Badge>
                                )) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto" />
                  <p>Analysis in progress...</p>
                  <p className="text-sm text-muted-foreground">
                    This may take a few minutes depending on repository size
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
