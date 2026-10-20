import { FLAVOUR_MARKS, type Flavour } from './flavour';

/** The little prop beside a flavoured eyebrow: steam off a plate, a bus pulling away, a sun turning. */
export function FlavourMark({ flavour }: { flavour: Flavour }) {
  const { Icon, motion } = FLAVOUR_MARKS[flavour];
  return <span className={`recap-flavour-mark is-${motion}`} aria-hidden="true">
    {motion === 'steam' ? <span className="recap-flavour-steam">{[0, 1, 2].map(i => <i key={i} />)}</span> : null}
    {motion === 'drive' ? <span className="recap-flavour-road"><i /><i /></span> : null}
    <Icon />
  </span>;
}
