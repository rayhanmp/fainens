import type { CSSProperties, ReactNode } from 'react';
import { Burst } from './Burst';
import type { RecapStory } from './stories';
import './covers.css';

type Intro = Extract<RecapStory, { id: 'intro' }>;
export type MoreCoverForm = 'ticket' | 'passport' | 'photostrip' | 'cartridge' | 'postcard' | 'cereal' | 'novel' | 'tearoff' | 'lineup' | 'comic';
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const letters = (word: string) => [...word].map((letter, i) => <span key={i} style={vars({ '--l': i })}>{letter}</span>);
/** A word set to shrink with its length, so a long month never overruns its object. */
const sized = (word: string) => vars({ '--n': Math.max(word.length, 4) });
/** Machine-readable text: capitals and digits only, padded with chevrons. */
const mrz = (text: string, length = 30) => text.toUpperCase().replace(/[^A-Z0-9<]/g, '').padEnd(length, '<').slice(0, length);

/**
 * Ten more objects the cover can be printed as, rolled per run alongside the magazine, poster, record
 * sleeve and boarding pass. Each prints only what the cover already knows: the period's name and dates,
 * the issue number, how many chapters and receipts this run holds, and its teasers.
 */
export function MoreCover({ form, story, headline, second, run }: { form: MoreCoverForm; story: Intro; headline: ReactNode; second: string; run: number }) {
  const { cover } = story;
  const body = <p className="recap-cover-body">{story.body}</p>;
  const facts = cover.teasers.length ? cover.teasers : [`${cover.purchaseCount} receipts`, `${cover.chapterCount} chapters`, story.dateRange];
  switch (form) {
    case 'ticket': return <div className="recap-cover recap-cover-ticket">
      <p className="recap-ticket-marquee" aria-hidden="true">{story.isPartial ? 'Now showing' : 'Final screening'}</p>
      <div className="recap-ticket">
        <div className="recap-ticket-main">
          <small>✳ Fainens Pictures presents</small>
          <strong style={sized(story.monthWord)}>{story.monthWord}</strong>
          <span>{second} · {cover.chapterCount} scenes</span>
          <div className="recap-ticket-grid">
            <div><small>Screen</small><b>{cover.issue}</b></div>
            <div><small>Seat</small><b>{cover.seat}</b></div>
            <div><small>Showing</small><b>{cover.startLabel} – {cover.endLabel}</b></div>
          </div>
        </div>
        <div className="recap-ticket-stub"><small>Admit one</small><b>{cover.purchaseCount}</b><small>receipts</small></div>
      </div>
      {headline}{body}
    </div>;
    case 'passport': return <div className="recap-cover recap-cover-passport">
      {headline}
      <div className="recap-cv-passport">
        <div className="recap-cv-passport-page">
          <span className="recap-cv-passport-title">Visas · Entries · {cover.passenger}</span>
          <span className="recap-visa-stamp is-entry" style={vars({ '--i': 0 })}><small>Arrived</small><b>{cover.startLabel}</b><small>{story.monthWord}</small></span>
          <span className="recap-visa-stamp is-exit" style={vars({ '--i': 1 })}>{story.isPartial
            ? <><small>Still here</small><b>Day {story.elapsedDays}</b><small>of {story.totalDays}</small></>
            : <><small>Departed</small><b>{cover.endLabel}</b><small>{second}</small></>}</span>
          <span className="recap-visa-stamp is-visa" style={vars({ '--i': 2 })}><small>Receipts declared</small><b>{cover.purchaseCount}</b></span>
          <span className="recap-visa-stamp is-seal" style={vars({ '--i': 3 })}><b>✳</b><small>Fainens</small></span>
        </div>
        <p className="recap-cv-passport-mrz" aria-hidden="true">
          <span>{mrz(`P<FNS${cover.passenger}<<${story.monthWord}`)}</span>
          <span>{mrz(`${String(cover.issue).padStart(6, '0')}<${cover.year}<<${cover.chapterCount}CH<${cover.purchaseCount}RC`)}</span>
        </p>
      </div>
      {body}
    </div>;
    case 'photostrip': return <div className="recap-cover recap-cover-photostrip">
      <div className="recap-photostrip" aria-hidden="true">
        <span className="recap-photo-frame is-title" style={vars({ '--i': 0 })}><b style={sized(story.monthWord)}>{story.monthWord}</b><small>{second}</small></span>
        {facts.slice(0, 3).map((line, i) => <span key={line} className={`recap-photo-frame is-${i + 1}`} style={vars({ '--i': i + 1 })}><i>{['✳', '★', '♥'][i]}</i><small>{line}</small></span>)}
        <span className="recap-photostrip-foot">{cover.startLabel} – {cover.endLabel}</span>
      </div>
      <div className="recap-photostrip-copy">
        <p className="recap-photostrip-kicker">Photo booth · {cover.chapterCount} shots</p>
        {headline}{body}
      </div>
    </div>;
    case 'cartridge': return <div className="recap-cover recap-cover-cartridge">
      <div className="recap-cv-cart" aria-hidden="true">
        <span className="recap-cv-cart-ridges" />
        <div className="recap-cv-cart-label">
          <span className="recap-cv-cart-brand">✳ Fainens</span>
          <strong style={sized(story.monthWord)}>{story.monthWord}</strong>
          <span className="recap-cv-cart-sub">{second} · {cover.chapterCount} levels</span>
          {[0, 1, 2, 3, 4].map(i => <i key={i} className="recap-cv-cart-pixel" style={vars({ '--i': i })} />)}
        </div>
        <span className="recap-cv-cart-seal">Official receipts</span>
      </div>
      <p className="recap-cv-cart-press">Press start</p>
      <div className="recap-cv-cart-stats"><span>Player 1 · {cover.passenger}</span><span>{cover.purchaseCount} receipts collected</span></div>
      {headline}{body}
    </div>;
    case 'postcard': return <div className="recap-cover recap-cover-postcard">
      {headline}
      <div className="recap-postcard">
        <div className="recap-postcard-front" aria-hidden="true">
          <small>Greetings from</small>
          <strong style={sized(story.monthWord)}>{letters(story.monthWord)}</strong>
          <span>{second}</span>
        </div>
        <div className="recap-postcard-back">
          <span className="recap-postcard-stamp" aria-hidden="true"><b>✳</b><small>Rp0</small></span>
          <span className="recap-postcard-postmark" aria-hidden="true"><small>{cover.startLabel}</small><small>{cover.endLabel}</small></span>
          <p className="recap-postcard-note">Wish you were here.</p>
          <p className="recap-postcard-line">To: {cover.passenger}</p>
          <p className="recap-postcard-line">{cover.purchaseCount} receipts inside</p>
        </div>
      </div>
      {body}
    </div>;
    case 'cereal': return <div className="recap-cover recap-cover-cereal">
      <div className="recap-cereal-stage" aria-hidden="true">
        <div className="recap-cereal">
          <span className="recap-cereal-brand">✳ Fainens</span>
          <strong className="recap-cereal-name" style={sized(story.monthWord)}>{story.monthWord}<em>Crunch</em></strong>
          <span className="recap-cereal-burst">Now with {cover.purchaseCount} receipts!</span>
          <span className="recap-cereal-bowl">{[0, 1, 2, 3, 4, 5].map(i => <i key={i} style={vars({ '--i': i })} />)}</span>
          <span className="recap-cereal-net">Net wt. {cover.chapterCount} chapters</span>
        </div>
        <div className="recap-cereal-facts">
          <b>Ledger facts</b>
          <small>Serving size: 1 period</small>
          <span><small>Days</small><b>{story.totalDays}</b></span>
          <span><small>Receipts</small><b>{cover.purchaseCount}</b></span>
          <span><small>Chapters</small><b>{cover.chapterCount}</b></span>
          {cover.keptShare !== null && <span><small>Left over</small><b>{cover.keptShare}%</b></span>}
        </div>
      </div>
      {headline}{body}
    </div>;
    case 'novel': return <div className="recap-cover recap-cover-novel">
      <div className="recap-book" aria-hidden="true">
        <span className="recap-book-band">✳ Fainens Classics</span>
        <div className="recap-book-face">
          <small>A novel in {cover.chapterCount} chapters</small>
          <strong style={sized(story.monthWord)}>{story.monthWord}</strong>
          <span className="recap-book-art"><i /><i /><i /></span>
          <span className="recap-book-author">{cover.passenger}</span>
        </div>
        <span className="recap-book-band is-foot">{second} · {cover.purchaseCount} receipts</span>
        <span className="recap-book-badge">{story.isPartial ? 'In progress' : 'Complete edition'}</span>
      </div>
      {headline}{body}
    </div>;
    case 'tearoff': {
      const day = story.isPartial ? story.elapsedDays : story.totalDays;
      return <div className="recap-cover recap-cover-tearoff">
        <div className="recap-tearoff" aria-hidden="true">
          <span className="recap-tearoff-rings"><i /><i /></span>
          <span className="recap-tearoff-head">{story.monthWord} {second}</span>
          <div className="recap-tearoff-pages">
            <span className="recap-tearoff-page is-final"><b>{day}</b><small>{story.isPartial ? `Day ${day} of ${story.totalDays}` : `${day} days, all torn`}</small></span>
            {[3, 2, 1].map((page, i) => <span key={page} className="recap-tearoff-page is-flying" style={vars({ '--i': 2 - i })}><b>{page}</b><small>{cover.startLabel}</small></span>)}
          </div>
        </div>
        {headline}{body}
      </div>;
    }
    case 'lineup': return <div className="recap-cover recap-cover-lineup">
      <span className="recap-cv-lineup-sun" aria-hidden="true"><i /><i /><i /></span>
      <small className="recap-cv-lineup-kicker">✳ Fainens presents</small>
      <strong className="recap-cv-lineup-name" style={sized(`${story.monthWord}Fest`)}>{story.monthWord}<span>Fest</span></strong>
      <span className="recap-cv-lineup-dates">{cover.startLabel} — {cover.endLabel} · {second}</span>
      <ul className="recap-cv-lineup-acts">{facts.slice(0, 4).map((line, i) => <li key={line} style={vars({ '--i': i })}>{line}</li>)}</ul>
      <span className="recap-cv-lineup-foot">{cover.chapterCount} stages · {cover.purchaseCount} receipts · {story.isPartial ? 'Live now' : 'Sold out'}</span>
      {headline}{body}
    </div>;
    case 'comic': return <div className="recap-cover recap-cover-comic">
      <div className="recap-comic" aria-hidden="true">
        <span className="recap-comic-corner"><small>No.</small><b>{cover.issue}</b><small>Rp0</small></span>
        <span className="recap-comic-kicker">The amazing</span>
        <strong className="recap-comic-title" style={sized(story.monthWord)}>{story.monthWord}</strong>
        <span className="recap-comic-pow">Pow!</span>
        <span className="recap-comic-bubble">{cover.purchaseCount} receipts!</span>
        <span className="recap-comic-caption">{story.isPartial ? 'To be continued' : 'The complete saga'} · {cover.chapterCount} chapters</span>
        <span className="recap-comic-seal">Ledger approved</span>
        <Burst seed={run} kind="stars" count={10} origin="title" delay={900} />
      </div>
      {headline}{body}
    </div>;
  }
}
