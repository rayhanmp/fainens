import type { CSSProperties } from 'react';
import { Heart, MessageCircle, Repeat2 } from 'lucide-react';
import { AnimatedValue } from '../AnimatedValue';
import type { RecapStory } from '../stories';
import { personaIcons } from '../personaIcons';
import './finales.css';

type Closing = Extract<RecapStory, { id: 'closing' }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;

export type ExtraFinaleForm = 'polaroid' | 'trading' | 'frontpage' | 'post' | 'trophy' | 'museum' | 'weather' | 'snowglobe';

/** The newer finales (lazily loaded): a polaroid wall, a trading card, a newspaper front page, a post,
 * a trophy on its podium, a museum wall, a weather forecast and a snow globe. */
export function ExtraFinale({ story, form, games, run }: { story: Closing; form: ExtraFinaleForm; games: string | null; run: number }) {
  const { finale, persona } = story;
  const top = finale.categories[0];
  const Icon = personaIcons[persona.key];
  if (form === 'trophy') {
    // The podium ranks the top three categories; the cup is engraved with the personality it earned.
    const podium = [finale.categories[1], finale.categories[0], finale.categories[2]];
    return <div className="recap-trophy-stage">
      <div className="recap-trophy" aria-hidden="true">
        <span className="recap-trophy-cup"><Icon /><span className="recap-trophy-handle is-left" /><span className="recap-trophy-handle is-right" /></span>
        <span className="recap-trophy-stem" />
        <span className="recap-trophy-plaque"><small>{finale.period}</small><b>{persona.name}</b></span>
      </div>
      <div className="recap-trophy-podium">{podium.map((row, i) => row ? <div key={row.label} className={`recap-trophy-podium-step is-${['second', 'first', 'third'][i]}`} style={vars({ '--i': i })}>
        <small>{row.label}</small><b>{['2', '1', '3'][i]}</b><span>{row.share}%</span>
      </div> : <div key={i} />)}</div>
      <p className="recap-trophy-note">{finale.purchaseCount} receipts · {finale.spendingDays} spending days{games ? ` · games ${games}` : ''}</p>
    </div>;
  }
  if (form === 'museum') {
    // The painting is the period's spending: one panel per top category, sized by its share.
    const panels = finale.categories.length ? finale.categories : [{ label: finale.period, share: 100 }];
    return <div className="recap-museum">
      <i className="recap-museum-light" aria-hidden="true" />
      <figure className="recap-museum-frame">
        <div className="recap-museum-canvas" aria-hidden="true">{panels.map((row, i) => <span key={row.label} className={`is-${i}`} style={vars({ '--share': Math.max(12, row.share), '--i': i })} />)}<b>✳</b></div>
      </figure>
      <div className="recap-museum-label">
        <b>{finale.period}</b>
        <small>{finale.passenger} · {finale.dateLabel}</small>
        <small>Receipts on ledger, {finale.purchaseCount} pieces</small>
        <p>{persona.tagline}</p>
      </div>
    </div>;
  }
  if (form === 'weather') {
    // A forecast read straight off the figures: the reading is what was left over, the outlook the top categories.
    const sunny = finale.net >= 0;
    return <div className="recap-weather">
      <div className="recap-weather-now">
        <span className={`recap-weather-icon ${sunny ? 'is-sun' : 'is-rain'}`} aria-hidden="true"><i /><i /><i /><i /></span>
        <div>
          <small>{finale.period}</small>
          <b>{finale.keptShare !== null ? `${finale.keptShare}°` : `${finale.purchaseCount}`}</b>
          <span>{sunny ? 'Clear: income ahead' : 'Showers: expenses ahead'}</span>
        </div>
      </div>
      <p className="recap-weather-reading">{finale.keptShare !== null ? 'Degrees of income left over' : 'Receipts on the radar'}</p>
      <ul className="recap-weather-outlook">{finale.categories.map((row, i) => <li key={row.label} style={vars({ '--i': i, '--share': row.share })}><small>{row.label}</small><i /><b>{row.share}%</b></li>)}</ul>
      <p className="recap-weather-foot"><span>Gusts: {finale.peakLabel ?? 'none'}</span><span>Spending days: {finale.spendingDays}</span></p>
      <p className="recap-weather-net">{sunny ? 'Left over' : 'Shortfall'} · <Money value={Math.abs(finale.net)} /></p>
    </div>;
  }
  if (form === 'snowglobe') {
    return <div className="recap-globe-stage">
      <div className="recap-globe" aria-hidden="true">
        <span className="recap-globe-glass">
          <span className="recap-globe-scene"><Icon /></span>
          {Array.from({ length: 22 }, (_, i) => <i key={i} className="recap-globe-snow" style={vars({ '--x': `${(i * 37 + run) % 90 + 5}%`, '--t': `${(i * 173) % 2400}ms`, '--d': `${2600 + (i * 211) % 1800}ms`, '--s': `${.8 + (i % 4) * .35}cqw` })} />)}
        </span>
        <span className="recap-globe-base"><small>{finale.period}</small><b>{persona.name}</b></span>
      </div>
      <p className="recap-globe-note">{finale.purchaseCount} receipts, shaken and settled{games ? ` · games ${games}` : ''}</p>
    </div>;
  }
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
          <p className="recap-tcard-head"><b>{persona.name}</b><span><small>HP</small>{finale.purchaseCount}</span></p>
          <div className="recap-tcard-art" aria-hidden="true"><span className="recap-tcard-halo"><Icon /></span><i className="recap-tcard-foil" /></div>
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
