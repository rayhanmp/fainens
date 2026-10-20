import type { CSSProperties } from 'react';
import { Heart, MessageCircle, Repeat2, Sparkles } from 'lucide-react';
import { AnimatedValue } from '../AnimatedValue';
import type { RecapStory } from '../stories';
import './finales.css';

type Closing = Extract<RecapStory, { id: 'closing' }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;

/** The newer finales (lazily loaded): a polaroid wall, a trading card, a newspaper front page, a post. */
export function ExtraFinale({ story, form, games, run }: { story: Closing; form: 'polaroid' | 'trading' | 'frontpage' | 'post'; games: string | null; run: number }) {
  const { finale, persona } = story;
  const top = finale.categories[0];
  if (form === 'polaroid') {
    const shots = [
      { caption: finale.period, art: '✳', note: finale.dateLabel },
      ...(top ? [{ caption: top.label, art: `${top.share}%`, note: 'the biggest slice' }] : []),
      ...(finale.peakLabel ? [{ caption: finale.peakLabel, art: '★', note: 'the big day' }] : []),
      { caption: persona.name.replace(/^The /, ''), art: '♥', note: 'that’s you' },
    ].slice(0, 4);
    return <div className="recap-polaroids">
      {shots.map((shot, i) => <figure key={shot.caption + i} className="recap-polaroid" style={vars({ '--i': i, '--r': `${[-8, 6, -3, 9][i]}deg`, '--x': `${[2, 48, 6, 50][i]}%`, '--y': `${[0, 3, 49, 52][i]}cqw` })}>
        <i className="recap-polaroid-tape" aria-hidden="true" />
        <span className={`recap-polaroid-photo is-${i}`}><b>{shot.art}</b></span>
        <figcaption>{shot.caption}<small>{shot.note}</small></figcaption>
      </figure>)}
      <p className="recap-polaroid-net">{finale.net >= 0 ? 'Left over' : 'Shortfall'} · <Money value={Math.abs(finale.net)} />{games ? ` · games ${games}` : ''}</p>
    </div>;
  }
  if (form === 'trading') {
    return <div className="recap-tcard-stage">
      <div className="recap-tcard">
        <div className="recap-tcard-face">
          <p className="recap-tcard-head"><b>{persona.name}</b><span>HP {finale.purchaseCount}</span></p>
          <div className="recap-tcard-art" aria-hidden="true"><Sparkles /><i className="recap-tcard-foil" /></div>
          <p className="recap-tcard-type">Persona card · {finale.period}</p>
          <ul className="recap-tcard-moves">{persona.evidence.slice(0, 2).map((move, i) => <li key={move} style={vars({ '--i': i })}><b>{['✦', '✧'][i]}</b>{move}</li>)}</ul>
          <p className="recap-tcard-flavour">{persona.tagline}</p>
          <p className="recap-tcard-foot"><span>{'★'.repeat(Math.min(5, 2 + (run % 4)))}</span><span>#{String(finale.purchaseCount).padStart(3, '0')}</span></p>
        </div>
        <div className="recap-tcard-back" aria-hidden="true"><b>✳</b></div>
      </div>
    </div>;
  }
  if (form === 'frontpage') {
    return <div className="recap-paper-stage">
      <article className="recap-frontpage">
        <p className="recap-frontpage-mast">The Fainens Times</p>
        <p className="recap-frontpage-dateline"><span>{finale.dateLabel}</span><span>Late edition</span></p>
        <h3>{finale.net >= 0 ? 'Income holds the line' : 'Expenses break through'}</h3>
        <p className="recap-frontpage-deck">{finale.net >= 0 ? 'Left over after expenses: ' : 'Short by '}<Money value={Math.abs(finale.net)} /></p>
        <div className="recap-frontpage-cols">
          <p><b>Markets.</b> {top ? `${top.label} led with ${top.share}% of spending.` : 'Spending spread across the board.'}</p>
          <p><b>Calendar.</b> {finale.peakLabel ? `${finale.peakLabel} was the busiest day.` : `${finale.spendingDays} days saw spending.`}</p>
          <p><b>People.</b> Readers named this period’s personality {persona.name.replace(/^The /, 'the ')}.</p>
        </div>
      </article>
    </div>;
  }
  const initial = (finale.passenger || 'Y').slice(0, 1).toUpperCase();
  return <div className="recap-post">
    <div className="recap-post-head"><span className="recap-post-avatar" aria-hidden="true">{initial}</span><span><b>{finale.passenger}</b><small>@fainens · just now</small></span></div>
    <p className="recap-post-text">My {finale.period} in review: {top ? `${top.label} took ${top.share}%` : 'a little of everything'}{finale.peakLabel ? `, the big day was ${finale.peakLabel}` : ''}. Verdict: {persona.name}.</p>
    <div className="recap-post-chips">{finale.categories.map((row, i) => <span key={row.label} style={vars({ '--i': i })}>{row.label} {row.share}%</span>)}</div>
    {/* The counters are the period's own figures: spending days, top categories, receipts. */}
    <div className="recap-post-actions" aria-hidden="true">
      <span><MessageCircle /><AnimatedValue value={finale.spendingDays} /></span>
      <span><Repeat2 /><AnimatedValue value={finale.categories.length} /></span>
      <span className="is-liked"><Heart /><AnimatedValue value={finale.purchaseCount} /></span>
    </div>
    {Array.from({ length: 6 }, (_, i) => <Heart key={i} className="recap-post-heart" aria-hidden="true" style={vars({ '--i': i, '--x': `${60 + i * 6}%` })} />)}
  </div>;
}
