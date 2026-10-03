import type { FrozenVoice, Voice } from '../src/voices/schema.js';

export const LISTENING_CRITERIA = ['attack', 'body', 'brightness', 'decay', 'release', 'controlTransition', 'gainComfort'] as const;
export type ListeningVerdict = 'A' | 'B' | 'no-preference' | 'not-assessed';
export interface ListeningInput {
  listener: string; device: string; output: string; notes: string; gainNotes: string; listened: boolean;
  criteria: Record<typeof LISTENING_CRITERIA[number], ListeningVerdict>;
}

function text(value: string, max: number, name: string, required = true): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new RangeError(`${name} must contain ${required ? '1' : '0'}..${max} characters`);
  return value.trim();
}

/** Local-only identity for the exact normalized synthesis parameters, not a voice-name alias. */
export async function patchIdentity(voice: Voice | FrozenVoice): Promise<{ id: string; patch: Voice | FrozenVoice }> {
  const patch = JSON.parse(JSON.stringify(voice)) as Voice;
  const bytes = new TextEncoder().encode(JSON.stringify(patch));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { id: `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`, patch };
}

export function listeningInput(input: ListeningInput): ListeningInput {
  if (input.listened !== true) throw new RangeError('Confirm that you actually listened to A and B at these selected settings');
  const criteria = {} as ListeningInput['criteria'];
  for (const criterion of LISTENING_CRITERIA) {
    const value = input.criteria[criterion];
    if (!['A', 'B', 'no-preference', 'not-assessed'].includes(value)) throw new RangeError(`Invalid ${criterion} verdict`);
    criteria[criterion] = value;
  }
  if (Object.values(criteria).every(value => value === 'not-assessed')) throw new RangeError('Assess at least one subjective criterion; automated measurements are not listening findings');
  return { listener: text(input.listener, 80, 'Anonymous listener label'), device: text(input.device, 160, 'Device / browser / OS'),
    output: text(input.output, 160, 'Output route / headphones / device volume'), notes: text(input.notes, 1024, 'Notes', false),
    gainNotes: text(input.gainNotes, 1024, 'Subjective gain notes', false), listened: true, criteria };
}
