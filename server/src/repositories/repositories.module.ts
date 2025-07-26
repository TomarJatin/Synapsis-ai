import { Module } from '@nestjs/common'
import { RepositoriesController } from './repositories.controller'
import { RepositoriesService } from './repositories.service'
import { PrismaModule } from 'src/prisma/prisma.module'
import { GitHubModule } from 'src/github/github.module'
import { AnalysisModule } from 'src/analysis/analysis.module'

@Module({
  imports: [PrismaModule, GitHubModule, AnalysisModule],
  controllers: [RepositoriesController],  
  providers: [RepositoriesService],
  exports: [RepositoriesService],
})
export class RepositoriesModule {} 