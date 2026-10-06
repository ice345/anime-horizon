import { z } from 'zod';

export const sessionAIProviderSchema = z.enum(['DEEPSEEK', 'OPENAI_COMPATIBLE']);

export const sessionAIConfigSchema = z.object({
  provider: sessionAIProviderSchema,
  apiKey: z.string().trim().min(1).max(512),
  endpoint: z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      );
    }, 'Personal endpoints must use HTTPS (HTTP is allowed for localhost)'),
  model: z.string().trim().min(1).max(128),
});

export type SessionAIConfig = z.infer<typeof sessionAIConfigSchema>;
export type SessionAIProvider = z.infer<typeof sessionAIProviderSchema>;

/**
 * AI reflection payload. Older or pasted reports may still contain `avoid` / `recommendations` title
 * lists; they are accepted (passthrough) but ignored: anime recommendations come only from the
 * deterministic For You engine (docs/recommendations.md).
 */
export const tasteAnalysisPayloadSchema = z
  .object({
    tags: z.array(z.string().trim().max(40)).max(12).optional().default([]),
    roast: z.string().max(6_000).optional(),
    analysis: z.string().max(6_000).optional(),
    personality: z.string().max(6_000).optional(),
    goldenEra: z.string().max(2_000).optional(),
    questions: z.array(z.string().trim().max(400)).max(6).optional().default([]),
  })
  .passthrough();

export const normalizedTasteAnalysisSchema = z.object({
  tags: z.array(z.string().max(40)).length(6),
  roast: z.string().max(6_000),
  personality: z.string().max(6_000),
  goldenEra: z.string().max(2_000),
  /** Up to three open questions for the user to reflect on. */
  questions: z.array(z.string().max(400)).max(3),
});

export type TasteAnalysisResult = z.infer<typeof normalizedTasteAnalysisSchema>;

export const chatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().min(1) }).passthrough(),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();
