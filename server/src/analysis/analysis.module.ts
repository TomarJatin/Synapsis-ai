import { Module } from '@nestjs/common'
import { AnalysisService } from './analysis.service'
import { PrismaModule } from 'src/prisma/prisma.module'
import { LLMModule } from 'src/llm/llm.module'
import { GitHubModule } from 'src/github/github.module'

@Module({
  imports: [PrismaModule, LLMModule, GitHubModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {} 