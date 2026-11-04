import type { Logger } from '../lib/logger.ts';
import { arlekinasAdapter } from './arlekinas/adapter.ts';
import { cinamonAdapter } from './cinamon/adapter.ts';
import { atlantisAdapter, garsasAdapter } from './fliko/adapter.ts';
import { forumAdapter } from './forum/adapter.ts';
import { apolloAdapter, pasakaAdapter } from './mcs/adapter.ts';
import { romuvaAdapter } from './romuva/adapter.ts';
import { skalvijaAdapter } from './skalvija/adapter.ts';
import type { SourceAdapter, SourceId } from './types.ts';
import { vueAdapter } from './vue/adapter.ts';

export type SourceConfig = {
  id: SourceId;
  enabled: boolean;
  /** Fetch even where robots.txt disallows it. Only with a written owner decision. */
  robotsOverride: boolean;
  overrideReason: string | null;
};

const OWNER_OVERRIDE_REASON = 'Owner decision 2026-10-30, see research.md §1b';

const strict = (id: SourceId): SourceConfig => ({
  id,
  enabled: true,
  robotsOverride: false,
  overrideReason: null,
});

export const sourceConfigs: readonly SourceConfig[] = [
  strict('apollo'),
  strict('forum'),
  strict('pasaka'),
  strict('skalvija'),
  strict('atlantis'),
  strict('garsas'),
  strict('romuva'),
  strict('arlekinas'),
  { id: 'vue', enabled: true, robotsOverride: true, overrideReason: OWNER_OVERRIDE_REASON },
  { id: 'cinamon', enabled: true, robotsOverride: true, overrideReason: OWNER_OVERRIDE_REASON },
];

/** One adapter per configured source. */
export const adapters: readonly SourceAdapter[] = [
  apolloAdapter,
  forumAdapter,
  pasakaAdapter,
  skalvijaAdapter,
  atlantisAdapter,
  garsasAdapter,
  romuvaAdapter,
  arlekinasAdapter,
  vueAdapter,
  cinamonAdapter,
];

export function findSourceConfig(id: SourceId): SourceConfig | undefined {
  return sourceConfigs.find((config) => config.id === id);
}

/** Every robots.txt override is logged at startup so it is never silent. */
export function logRobotsOverrides(logger: Logger, configs = sourceConfigs): void {
  for (const config of configs) {
    if (config.enabled && config.robotsOverride) {
      logger.warn(
        { source: config.id, reason: config.overrideReason },
        'Source runs with a robots.txt override',
      );
    }
  }
}
