import type { AiConfig } from './ai.js';

export interface StageDef {
  id: number;
  name: string;
  category: string;
  ai: AiConfig;
  /** points granted on first clear */
  reward: number;
}

export const STAGES: StageDef[] = [
  { id: 1, name: '櫃檯實習', category: 'finance_basics', ai: { scorePerSec: 0.5, strategy: ['tank', 'tank', 'archer'], warmupMs: 8000 }, reward: 60 },
  { id: 2, name: '法遵新兵', category: 'bank_law', ai: { scorePerSec: 0.8, strategy: ['tank', 'archer'], warmupMs: 5000 }, reward: 70 },
  { id: 3, name: '信託入門', category: 'trust', ai: { scorePerSec: 1.0, strategy: ['tank', 'archer', 'tank', 'mage'], warmupMs: 3000 }, reward: 80 },
  { id: 4, name: '理財顧問', category: 'wealth', ai: { scorePerSec: 1.3, strategy: ['tank', 'archer', 'mage'] }, reward: 90 },
  { id: 5, name: '市場快訊', category: 'news', ai: { scorePerSec: 1.6, strategy: ['tank', 'archer', 'runner', 'mage'] }, reward: 100 },
  { id: 6, name: '法遵主管', category: 'bank_law', ai: { scorePerSec: 1.9, strategy: ['tank', 'mage', 'archer', 'medic'] }, reward: 120 },
  { id: 7, name: '信託經理', category: 'trust', ai: { scorePerSec: 2.6, strategy: ['tank', 'archer', 'mage', 'medic', 'runner'] }, reward: 140 },
  { id: 8, name: '財富總監', category: 'wealth', ai: { scorePerSec: 3.0, strategy: ['tank', 'tank', 'archer', 'mage', 'medic', 'mage'] }, reward: 160 },
];

export const CATEGORIES: { id: string; name: string }[] = [
  { id: 'finance_basics', name: '金融常識' },
  { id: 'bank_law', name: '銀行法規' },
  { id: 'trust', name: '信託實務' },
  { id: 'wealth', name: '理財規劃' },
  { id: 'news', name: '財金時事' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
