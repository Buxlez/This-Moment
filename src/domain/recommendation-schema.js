const { z } = require('zod');

const DirectionSchema = z.object({
  atmosphere: z.array(z.string().trim().min(1)).min(1).max(5),
  energy: z.string().trim().min(1).max(30),
  rhythm: z.array(z.string().trim().min(1)).min(1).max(5),
}).strict();

const CandidateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120),
}).strict();

const RecommendationPlanSchema = z.object({
  intent: z.enum(['recommend', 'cold_start', 'refine', 'refresh']),
  direction: DirectionSchema,
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(2).max(220),
  candidates: z.array(CandidateSchema).min(1).max(70),
}).strict();

module.exports = { DirectionSchema, CandidateSchema, RecommendationPlanSchema };
