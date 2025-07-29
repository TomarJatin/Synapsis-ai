import { Module } from '@nestjs/common'
import { SearchService } from './search.service'
import { SearchController } from './search.controller'
import { PrismaModule } from 'src/prisma/prisma.module'
import { LLMModule } from 'src/llm/llm.module'

@Module({
  imports: [PrismaModule, LLMModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {} 