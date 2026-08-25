import type { EpisodeRetention } from '@sweam/shared';

const CHECKPOINTS = ['Start', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', 'End'];

/**
 * Audience retention as a table: one row per episode, one column per runtime
 * checkpoint, each cell the share of tracked viewers who got that far. A table
 * carries the exact numbers for every reader, screen reader or not.
 */
export function RetentionTable({ retention }: { retention: EpisodeRetention[] }) {
  if (retention.length === 0) return <p>No episodes yet.</p>;
  return (
    <div className="table-scroll">
      <table className="studio-table">
        <caption className="visually-hidden">
          Share of tracked viewers reaching each point of the runtime, per episode
        </caption>
        <thead>
          <tr>
            <th scope="col">Episode</th>
            <th scope="col">Tracked viewers</th>
            {CHECKPOINTS.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retention.map((episode) => (
            <tr key={episode.episodeId}>
              <th scope="row">
                S{episode.season} E{episode.episode}: {episode.name}
              </th>
              <td>{episode.viewers}</td>
              {episode.curve.length === 0 ? (
                <td colSpan={CHECKPOINTS.length}>No tracked viewers yet</td>
              ) : (
                episode.curve.map((value, index) => (
                  <td key={CHECKPOINTS[index]}>{Math.round(value * 100)}%</td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
