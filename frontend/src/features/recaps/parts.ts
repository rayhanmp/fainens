import { useState } from 'react';

/**
 * Lazily loaded groups of variations. The core recap ships the house layouts; a run that rolls a second
 * look for a chapter loads its group during the opening (each group brings its own CSS). A chapter reads
 * its group once, when it mounts: if it has arrived it is used, otherwise the house layout plays. So a
 * slow network costs a variation, never a blank card or a layout swapping mid-chapter.
 */
const loaders = {
  layouts: () => import('./extra/Layouts'),
  persona: () => import('./extra/PersonaExtra'),
  bonus: () => import('./extra/BonusExtra'),
  games: () => import('./extra/GamesExtra'),
  finales: () => import('./extra/Finales'),
};
export type PartName = keyof typeof loaders;
type PartModule<Name extends PartName> = Awaited<ReturnType<(typeof loaders)[Name]>>;

const ready: { [Name in PartName]?: PartModule<Name> } = {};
const pending = new Map<PartName, Promise<unknown>>();

export function loadPart<Name extends PartName>(name: Name): Promise<PartModule<Name>> {
  if (ready[name]) return Promise.resolve(ready[name] as PartModule<Name>);
  let promise = pending.get(name) as Promise<PartModule<Name>> | undefined;
  if (!promise) {
    promise = (loaders[name]() as Promise<PartModule<Name>>).then(module => { (ready as Record<string, unknown>)[name] = module; return module; });
    // A failed load is forgotten so a later run can try again; the house layout covers it meanwhile.
    promise.catch(() => pending.delete(name));
    pending.set(name, promise);
  }
  return promise;
}

export const preloadParts = (names: Iterable<PartName>) => { for (const name of names) void loadPart(name).catch(() => undefined); };

/** The group if it has loaded by the time this component mounts; fixed for the component's life. */
export function useLoadedPart<Name extends PartName>(name: Name, wanted: boolean): PartModule<Name> | undefined {
  const [module] = useState(() => wanted ? ready[name] as PartModule<Name> | undefined : undefined);
  return module;
}
