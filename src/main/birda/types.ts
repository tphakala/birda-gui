// Re-export types from shared/types.ts to avoid duplication
// These types are shared between main and renderer processes
export type { BirdaEventEnvelope } from '../../../shared/types';

export interface BirdaDetection {
  species: string;
  scientific_name: string;
  common_name: string;
  confidence: number;
  start_time: number;
  end_time: number;
}
