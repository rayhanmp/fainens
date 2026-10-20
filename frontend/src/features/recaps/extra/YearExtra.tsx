import type { CSSProperties } from 'react';
import { CategoryIcon } from '../../categories/CategoryIcon';
import { personaIcons } from '../personaIcons';
import type { RecapStory } from '../stories';
import './year-extra.css';

type YearStory = Extract<RecapStory, { id: 'year' }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const icon = (name: string) => <CategoryIcon name={name} color="currentColor" className="h-[1em] w-[1em]" />;

/** A year's own insights (lazily loaded with the year in review): read across its periods, month by month. */
export function YearVisual({ story }: { story: YearStory }) {
  const { insight } = story;
  switch (insight.kind) {
    case 'headliners': {
      // A wall of month tiles, each showing who topped that month; the year's usual headliner is inked in.
      const columns = insight.months.length > 9 ? 4 : 3;
      return <div className="recap-year recap-headliners" style={vars({ '--cols': columns })}>
        {insight.months.map((month, i) => <div key={`${month.label}${i}`} className={month.category === insight.leader.name ? 'is-leader' : undefined} style={vars({ '--i': i })}>
          <small>{month.label}</small>
          {month.category ? <span className="recap-headliner-icon">{icon(month.category)}</span> : <span className="recap-headliner-icon">–</span>}
          <b>{month.categoryLabel ?? 'Nothing'}</b>
        </div>)}
      </div>;
    }
    case 'green': {
      // Money in against money out for every month, side by side; a filled dot marks the months in the green.
      const max = Math.max(1, ...insight.months.flatMap(month => [month.income, month.expenses]));
      return <div className="recap-year recap-greenbars">
        <div className="recap-greenbars-plot">
          {insight.months.map((month, i) => <div key={`${month.label}${i}`} className={[month.income > 0 && month.income >= month.expenses && 'is-green', insight.best?.label === month.label && 'is-best'].filter(Boolean).join(' ')} style={vars({ '--i': i })}>
            <span className="recap-greenbars-pair">
              <i className="is-in" style={vars({ '--h': month.income / max })} />
              <i className="is-out" style={vars({ '--h': month.expenses / max })} />
            </span>
            <b aria-hidden="true" />
            <small>{month.label}</small>
          </div>)}
        </div>
        <p className="recap-greenbars-key"><span><i className="is-in" />In</span><span><i className="is-out" />Out</span><span><b />Kept some</span></p>
      </div>;
    }
    case 'personas': {
      // The personalities that came up, biggest first, then the year as a strip of them.
      const counts = [...insight.months.reduce((all, month) => all.set(month.key, { name: month.persona, count: (all.get(month.key)?.count ?? 0) + 1 }), new Map<string, { name: string; count: number }>())]
        .sort((a, b) => b[1].count - a[1].count).slice(0, 3);
      return <div className="recap-year recap-personas">
        <div className="recap-personas-podium">
          {counts.map(([key, entry], i) => { const Icon = personaIcons[key as keyof typeof personaIcons]; return <div key={key} className={i === 0 ? 'is-leader' : undefined} style={vars({ '--i': i })}>
            <span className="recap-personas-badge"><Icon /><em>×{entry.count}</em></span>
            <b>{entry.name.replace(/^The /, '')}</b>
          </div>; })}
        </div>
        <ol className="recap-personas-strip" style={vars({ '--cols': insight.months.length <= 6 ? insight.months.length : Math.ceil(insight.months.length / 2) })}>
          {insight.months.map((month, i) => { const Icon = personaIcons[month.key]; return <li key={`${month.label}${i}`} className={month.key === insight.leader.key ? 'is-leader' : undefined} style={vars({ '--i': i })}>
            <span><Icon /></span><small>{month.label}</small>
          </li>; })}
        </ol>
      </div>;
    }
    case 'regulars':
      // Two lists: the categories that turned up every month, and the ones that came once.
      return <div className="recap-year recap-regulars">
        {insight.regulars.length ? <section>
          <p className="recap-regulars-head">Every month · {insight.periods} of {insight.periods}</p>
          <ul>{insight.regulars.map((row, i) => <li key={row.name} className="is-regular" style={vars({ '--i': i })}>{icon(row.name)}<span>{row.label}</span></li>)}
            {insight.regularCount > insight.regulars.length ? <li className="is-more" style={vars({ '--i': insight.regulars.length })}>+{insight.regularCount - insight.regulars.length} more</li> : null}</ul>
        </section> : null}
        {insight.cameos.length ? <section>
          <p className="recap-regulars-head">Just once</p>
          <ul>{insight.cameos.map((row, i) => <li key={row.name} className="is-cameo" style={vars({ '--i': i + insight.regulars.length })}>{icon(row.name)}<span>{row.label}</span><small>{row.month}</small></li>)}</ul>
        </section> : null}
      </div>;
  }
}
