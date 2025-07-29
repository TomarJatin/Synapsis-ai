'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Search, MessageSquare, Code2, FileText, Database, Settings, Brain, HelpCircle, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface SearchMessage {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  searchResults?: SearchResult[]
  searchPatterns?: any
  intentResult?: IntentDetectionResult
  responseType?: 'code_search' | 'casual_response' | 'help_response'
  isStreaming?: boolean
  showAllResults?: boolean
}

interface IntentDetectionResult {
  intent: 'code_search' | 'casual_conversation' | 'help_request'
  confidence: number
  reasoning: string
  suggestedResponse?: string
}

interface SearchResult {
  repository: {
    id: string
    fullName: string
    description: string | null
  }
  file: {
    path: string
    language: string
  }
  matches: Array<{
    type: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'comment' | 'general'
    name: string
    snippet: string
    lineStart: number
    lineEnd: number
    score: number
    explanation: string
  }>
  overallScore: number
}

interface SearchPatterns {
  searchTerms: string[]
  filePatterns: string[]
  codePatterns: string[]
  frameworkHints: string[]
}

interface SearchProgress {
  step: number
  totalSteps: number
  message: string
  patterns?: SearchPatterns
  repositories?: Array<{ id: string; fullName: string }>
  rawResultsCount?: number
  scoredResultsCount?: number
  intent?: string
  confidence?: number
}

export default function CodeSearchChat() {
  const [messages, setMessages] = useState<SearchMessage[]>([
    {
      id: '1',
      type: 'system',
      content: 'Welcome to the Code Search Assistant! 👋\n\nI can help you find code implementations, patterns, and snippets across your analyzed repositories. You can also just chat with me!\n\n**Try asking me:**\n• "Show me NextAuth implementation"\n• "Find authentication patterns"\n• "How does login work?"\n• Or just say "hi" to start a conversation!',
      timestamp: new Date(),
      showAllResults: false
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [currentProgress, setCurrentProgress] = useState<SearchProgress | null>(null)
  const [selectedFilters] = useState<{
    languages: string[]
    frameworks: string[]
    complexity?: 'low' | 'medium' | 'high'
  }>({
    languages: [],
    frameworks: []
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const toggleShowAllResults = (messageId: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, showAllResults: !msg.showAllResults }
        : msg
    ))
  }

  const handleSearch = async () => {
    if (!inputValue.trim() || isSearching) return

    const userMessage: SearchMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue,
      timestamp: new Date(),
      showAllResults: false
    }

    const assistantMessage: SearchMessage = {
      id: (Date.now() + 1).toString(),
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      showAllResults: false
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInputValue('')
    setIsSearching(true)
    setCurrentProgress(null)

    try {
      // Build query parameters for GET request
      const queryParams = new URLSearchParams({
        query: inputValue
      })

      // Add filters as query parameters
      if (selectedFilters.languages.length > 0) {
        queryParams.append('languages', selectedFilters.languages.join(','))
      }
      if (selectedFilters.frameworks.length > 0) {
        queryParams.append('frameworks', selectedFilters.frameworks.join(','))
      }
      if (selectedFilters.complexity) {
        queryParams.append('complexity', selectedFilters.complexity)
      }

      // Start SSE connection for streaming search with query parameters
      const eventSource = new EventSource(`http://localhost:3001/search/stream?${queryParams.toString()}`, {
        withCredentials: false
      })
      eventSourceRef.current = eventSource

      let currentMessageContent = ''
      let currentIntentResult: IntentDetectionResult | undefined
      let currentResponseType: 'code_search' | 'casual_response' | 'help_response' = 'code_search'

      eventSource.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          console.log('SSE Event:', event.type, data)
        } catch (error) {
          console.error('Failed to parse SSE data:', error)
        }
      }

      // Handle specific event types
      eventSource.addEventListener('connected', (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        console.log('Connected:', data)
      })

      eventSource.addEventListener('intent', (event) => {
        const data = JSON.parse(event.data)
        currentIntentResult = {
          intent: data.intent,
          confidence: data.confidence,
          reasoning: data.reasoning
        }
        
        // Determine response type based on intent
        if (data.intent === 'casual_conversation') {
          currentResponseType = 'casual_response'
          currentMessageContent = 'Generating a friendly response...'
        } else if (data.intent === 'help_request') {
          currentResponseType = 'help_response'
          currentMessageContent = 'Preparing helpful information...'
        } else {
          currentResponseType = 'code_search'
          currentMessageContent = 'Preparing code search...'
        }
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent, intentResult: currentIntentResult, responseType: currentResponseType }
            : msg
        ))
      })

      eventSource.addEventListener('status', (event) => {
        const data = JSON.parse(event.data)
        setCurrentProgress(data)
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: data.message }
            : msg
        ))
      })

      // Handle streaming text content (for casual/help responses)
      eventSource.addEventListener('text_chunk', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent += data.chunk
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent }
            : msg
        ))
      })

      eventSource.addEventListener('patterns', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent = `Generated search patterns: ${data.patterns.searchTerms.join(', ')}`
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent, searchPatterns: data.patterns }
            : msg
        ))
      })

      eventSource.addEventListener('repositories', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent = `Searching through ${data.count} repositories...`
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent }
            : msg
        ))
      })

      eventSource.addEventListener('raw_results', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent = `Found ${data.count} potential matches, analyzing relevance...`
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent }
            : msg
        ))
      })

      eventSource.addEventListener('scored_results', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent = `Ranked ${data.count} results by relevance...`
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent }
            : msg
        ))
      })

      eventSource.addEventListener('summary', (event) => {
        const data = JSON.parse(event.data)
        currentMessageContent = data.summary
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: currentMessageContent }
            : msg
        ))
      })

      eventSource.addEventListener('results', (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                content: data.summary || currentMessageContent,
                searchResults: data.results,
                intentResult: currentIntentResult,
                responseType: currentResponseType,
                isStreaming: false
              }
            : msg
        ))
      })

      eventSource.addEventListener('complete', (event) => {
        const data = JSON.parse(event.data)
        console.log('Search completed:', data)
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                isStreaming: false,
                intentResult: currentIntentResult,
                responseType: currentResponseType
              }
            : msg
        ))
        
        setIsSearching(false)
        setCurrentProgress(null)
        eventSource.close()
      })

      eventSource.addEventListener('error', (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        console.error('Search error:', data)
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                content: `Search failed: ${data.error}`,
                isStreaming: false
              }
            : msg
        ))
        
        setIsSearching(false)
        setCurrentProgress(null)
        eventSource.close()
      })

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error)
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                content: 'Connection error occurred during search.',
                isStreaming: false
              }
            : msg
        ))
        
        setIsSearching(false)
        setCurrentProgress(null)
        eventSource.close()
      }

    } catch (error) {
      console.error('Search failed:', error)
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessage.id 
          ? { 
              ...msg, 
              content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              isStreaming: false
            }
          : msg
      ))
      
      setIsSearching(false)
      setCurrentProgress(null)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch()
    }
  }

  const getMatchTypeIcon = (type: string) => {
    switch (type) {
      case 'function': return <Code2 className="w-4 h-4" />
      case 'class': return <Database className="w-4 h-4" />
      case 'interface': return <Settings className="w-4 h-4" />
      case 'variable': return <FileText className="w-4 h-4" />
      default: return <FileText className="w-4 h-4" />
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    if (score >= 60) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    if (score >= 40) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  }

  const getIntentIcon = (intent?: string) => {
    switch (intent) {
      case 'code_search': return <Search className="w-4 h-4 text-white" />
      case 'casual_conversation': return <MessageSquare className="w-4 h-4 text-white" />
      case 'help_request': return <HelpCircle className="w-4 h-4 text-white" />
      default: return <Brain className="w-4 h-4 text-white" />
    }
  }

  const getResponseTypeColor = (responseType?: string) => {
    switch (responseType) {
      case 'code_search': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'casual_response': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'help_response': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  const renderMessageContent = (content: string) => {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm">
        <ReactMarkdown
          components={{
            code({ node, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '')
              const isInline = !match
              return !isInline ? (
                <div className="relative">
                  <div className="absolute top-2 right-2 text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded z-10">
                    {match[1]}
                  </div>
                  <SyntaxHighlighter
                    style={oneDark as any}
                    language={match[1]}
                    PreTag="div"
                    className="rounded-lg"
                    showLineNumbers={true}
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            },
            pre: ({ children }) => <div className="overflow-x-auto">{children}</div>,
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
            li: ({ children }) => <li className="mb-1">{children}</li>,
            h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-bold mb-2">{children}</h3>,
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-gray-300 pl-4 italic my-2">
                {children}
              </blockquote>
            )
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  const getResultsToShow = (message: SearchMessage) => {
    if (!message.searchResults) return []
    return message.showAllResults ? message.searchResults : message.searchResults.slice(0, 5)
  }

  return (
    <div className="flex flex-col h-auto max-w-6xl mx-auto p-4">
      <Card className="flex-1 flex flex-col border-2">
        <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
              <Search className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Code Search Assistant
              </h2>
              <p className="text-sm text-muted-foreground">AI-powered code discovery and conversation</p>
            </div>
          </div>
          
          {currentProgress && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="flex-1">{currentProgress.message}</span>
                <Badge variant="outline" className="text-xs">
                  {currentProgress.step}/{currentProgress.totalSteps}
                </Badge>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${(currentProgress.step / currentProgress.totalSteps) * 100}%` }}
                />
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 p-0 overflow-hidden max-h-[600px] overflow-y-auto">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                    message.type === 'user' 
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' 
                      : message.type === 'system'
                      ? 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 text-gray-700 dark:text-gray-300 border'
                      : 'bg-white dark:bg-gray-800 border shadow-md'
                  }`}>
                    <div className="flex items-start gap-3">
                      {message.type === 'assistant' && (
                        <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                          {getIntentIcon(message.intentResult?.intent)}
                        </div>
                      )}
                      {message.type === 'system' && (
                        <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center">
                          <Lightbulb className="w-4 h-4 text-white" />
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        {/* Intent Detection Badge */}
                        {message.intentResult && (
                          <div className="flex items-center gap-2 mb-3">
                            <Badge className={getResponseTypeColor(message.responseType)}>
                              {getIntentIcon(message.intentResult.intent)}
                              <span className="ml-1 capitalize">
                                {message.intentResult.intent.replace('_', ' ')}
                              </span>
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {message.intentResult.confidence}% confidence
                            </Badge>
                          </div>
                        )}
                        
                        {/* Render markdown content */}
                        <div className="markdown-content">
                          {message.type === 'user' ? (
                            <div className="whitespace-pre-wrap break-words">{message.content}</div>
                          ) : (
                            renderMessageContent(message.content)
                          )}
                        </div>
                        
                        {message.searchResults && message.searchResults.length > 0 && (
                          <div className="mt-6 space-y-4">
                            <Separator />
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Code2 className="w-4 h-4" />
                                <h4 className="font-semibold text-sm">Code Search Results</h4>
                                <Badge variant="secondary" className="text-xs">
                                  {message.searchResults.length} found
                                </Badge>
                              </div>
                              
                              {message.searchResults.length > 5 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleShowAllResults(message.id)}
                                  className="text-xs h-7"
                                >
                                  {message.showAllResults ? (
                                    <>
                                      <ChevronUp className="w-3 h-3 mr-1" />
                                      Show Less
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3 h-3 mr-1" />
                                      Show All ({message.searchResults.length})
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                            
                            <div className="space-y-3">
                              {getResultsToShow(message).map((result, index) => (
                                <Card key={index} className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                                  <CardContent className="p-4">
                                    <div className="flex items-start justify-between mb-3">
                                      <div className="min-w-0 flex-1">
                                        <h5 className="font-semibold text-sm truncate">{result.repository.fullName}</h5>
                                        <p className="text-xs text-muted-foreground font-mono truncate">{result.file.path}</p>
                                      </div>
                                      <Badge className={getScoreColor(result.overallScore)}>
                                        {Math.round(result.overallScore)}%
                                      </Badge>
                                    </div>
                                    
                                    <div className="space-y-2">
                                      {result.matches.slice(0, 3).map((match, matchIndex) => (
                                        <div key={matchIndex} className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
                                          <div className="flex-shrink-0 w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center">
                                            {getMatchTypeIcon(match.type)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                              <span className="font-mono text-sm font-semibold truncate">{match.name}</span>
                                              <Badge variant="outline" className="text-xs flex-shrink-0">
                                                {match.type}
                                              </Badge>
                                            </div>
                                            <div className="text-xs text-muted-foreground bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono overflow-x-auto">
                                              <SyntaxHighlighter
                                                language={result.file.language.toLowerCase()}
                                                style={oneDark as any}
                                                customStyle={{
                                                  margin: 0,
                                                  padding: '8px',
                                                  background: 'transparent',
                                                  fontSize: '11px',
                                                  lineHeight: '1.2'
                                                } as any}
                                                PreTag="div"
                                              >
                                                {match.snippet}
                                              </SyntaxHighlighter>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2">{match.explanation}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {message.isStreaming && (
                          <div className="flex items-center gap-2 mt-4 text-blue-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-xs">Processing...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </CardContent>

        <div className="border-t bg-gray-50 dark:bg-gray-900 p-4">
          <div className="flex gap-3">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me anything about your code or just say hello! 💬"
              disabled={isSearching}
              className="flex-1 border-2 focus:border-blue-500 transition-colors"
            />
            <Button 
              onClick={handleSearch} 
              disabled={isSearching || !inputValue.trim()}
              size="icon"
              className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 w-12 h-12"
            >
              {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </Button>
          </div>
          
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <span>Press Enter to search</span>
            <Separator orientation="vertical" className="h-3" />
            <span>✨ AI-powered intent detection</span>
            <Separator orientation="vertical" className="h-3" />
            <span>🔍 AST-based code analysis</span>
          </div>
        </div>
      </Card>
    </div>
  )
} 