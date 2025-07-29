import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import RepositoryManager from '@/components/repositories/RepositoryManager'
import CodeSearchChat from '@/components/search/CodeSearchChat'
import { GitBranch, Search } from 'lucide-react'

export default function DashboardPage() {
  return (
    <div className="h-screen overflow-y-auto bg-gray-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Repository Analysis & Search Dashboard
          </h1>
          <p className="text-gray-600 mt-1">
            Analyze repositories and search for code implementations using AI-powered AST analysis
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <Tabs defaultValue="repositories" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="repositories" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Repositories
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              Code Search
            </TabsTrigger>
          </TabsList>

          <TabsContent value="repositories" className="mt-6">
            <RepositoryManager />
          </TabsContent>

          <TabsContent value="search" className="mt-6">
            <CodeSearchChat />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
} 