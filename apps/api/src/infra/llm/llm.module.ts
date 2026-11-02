import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config/config.module';
import { AnthropicLlmAdapter } from './anthropic-llm.adapter';
import { DisabledLlm } from './disabled-llm.adapter';
import { LlmPort } from './llm.port';

@Global()
@Module({
  providers: [
    {
      provide: LlmPort,
      inject: [ConfigService],
      useFactory: (config: AppConfigService): LlmPort => {
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        if (!apiKey) {
          new Logger('Llm').warn('ANTHROPIC_API_KEY not set: AI assistant paused');
          return new DisabledLlm();
        }
        return AnthropicLlmAdapter.create(apiKey, {
          model: config.get('LLM_MODEL', { infer: true }),
          timeoutMs: config.get('LLM_TIMEOUT_MS', { infer: true }),
        });
      },
    },
  ],
  exports: [LlmPort],
})
export class LlmModule {}
