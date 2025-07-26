import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { PrismaModule } from './prisma/prisma.module'
import { LLMModule } from './llm/llm.module'
import { GitHubModule } from './github/github.module'
import { AnalysisModule } from './analysis/analysis.module'
import { RepositoriesModule } from './repositories/repositories.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    PrismaModule,
    LLMModule,
    GitHubModule,
    AnalysisModule,
    RepositoriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
