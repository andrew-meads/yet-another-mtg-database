/**
 * CardResults
 * -----------
 * Renders the outcome of a scan. For each detected card it shows:
 *   - the de-skewed crop (Part 1),
 *   - its best identification (Part 2) with a Scryfall thumbnail for side-by-side
 *     verification, and an expandable ranked top-N list of candidates,
 * plus a count, an empty state, and a toggle for the backend's debug overlay.
 */
import { useState } from 'react'
import type { CardMatch, ScannedCard, ScanResponse } from '../types'

/** Props for {@link CardResults}. */
interface CardResultsProps {
  /** The latest scan response, or null before the first scan. */
  result: ScanResponse | null
}

export function CardResults({ result }: CardResultsProps) {
  // Whether the debug overlay image is currently expanded.
  const [showDebug, setShowDebug] = useState(false)

  // Nothing to show until the first scan completes.
  if (!result) return null

  const debug = result.debugUrl ? (
    <DebugToggle url={result.debugUrl} show={showDebug} onToggle={() => setShowDebug((s) => !s)} />
  ) : null

  // Empty state: detector ran but found no cards.
  if (result.count === 0) {
    return (
      <section className="results">
        <p className="empty">
          No cards detected. Try better lighting and a contrasting background.
        </p>
        {debug}
      </section>
    )
  }

  return (
    <section className="results">
      <h2>
        {result.count} card{result.count === 1 ? '' : 's'} found
      </h2>
      <div className="card-list">
        {result.cards.map((card) => (
          <DetectedCard key={card.id} card={card} />
        ))}
      </div>
      {debug}
    </section>
  )
}

/** One detected card: the de-skewed crop next to its identification panel. */
function DetectedCard({ card }: { card: ScannedCard }) {
  const best = card.matches[0] ?? null
  return (
    <article className="detected">
      {/* The de-skewed crop from Part 1. */}
      <figure className="crop">
        <img src={card.url} alt={`Detected card ${card.id}`} loading="lazy" />
        <figcaption>Detected crop</figcaption>
      </figure>

      {/* The identification result from Part 2. */}
      {best ? (
        <Identification matches={card.matches} />
      ) : (
        <div className="ident empty">
          No identification — has the index been built? (<code>build_index</code>)
        </div>
      )}
    </article>
  )
}

/** Best-match summary + verification thumbnail + expandable candidate list. */
function Identification({ matches }: { matches: CardMatch[] }) {
  const [expanded, setExpanded] = useState(false)
  const best = matches[0]

  return (
    <div className="ident">
      <div className="best">
        {/* Side-by-side Scryfall art makes a human "yes/no" trivial. */}
        {best.imageUrl && (
          <img className="thumb" src={best.imageUrl} alt={best.name} loading="lazy" />
        )}
        <div className="best-meta">
          <h3>
            {best.name}{' '}
            {!best.confident && <span className="badge">low confidence</span>}
          </h3>
          <p className="sub">
            {best.set?.toUpperCase()} #{best.collectorNumber}
            {best.face && best.face !== 'single' ? ` · ${best.face}` : ''}
          </p>
          <p className="metrics">
            inliers {best.inliers} · score {best.featureScore.toFixed(0)} · hash{' '}
            {best.hammingDistance}
          </p>
          {best.scryfallUri && (
            <a href={best.scryfallUri} target="_blank" rel="noreferrer">
              View on Scryfall ↗
            </a>
          )}
        </div>
      </div>

      {matches.length > 1 && (
        <div className="alts">
          <button type="button" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Hide' : 'Show'} {matches.length - 1} other candidate
            {matches.length - 1 === 1 ? '' : 's'}
          </button>
          {expanded && (
            <ol className="candidate-list">
              {matches.slice(1).map((m) => (
                <li key={`${m.scryfallId}-${m.face}`}>
                  {m.imageUrl && <img src={m.imageUrl} alt={m.name} loading="lazy" />}
                  <span>
                    <strong>{m.name}</strong>
                    <br />
                    {m.set?.toUpperCase()} #{m.collectorNumber} · inliers {m.inliers} · hash{' '}
                    {m.hammingDistance}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

/** Props for {@link DebugToggle}. */
interface DebugToggleProps {
  /** URL of the debug overlay image. */
  url: string
  /** Whether the overlay is currently shown. */
  show: boolean
  /** Toggle handler. */
  onToggle: () => void
}

/** A button that shows/hides the detection-overlay image. */
function DebugToggle({ url, show, onToggle }: DebugToggleProps) {
  return (
    <div className="debug">
      <button type="button" onClick={onToggle}>
        {show ? 'Hide' : 'Show'} detection overlay
      </button>
      {show && <img src={url} alt="Detection overlay" className="debug-img" />}
    </div>
  )
}
