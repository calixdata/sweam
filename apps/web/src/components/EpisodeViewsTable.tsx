import type { EpisodeViews } from '@sweam/shared';

/** Views and finishes per episode, in season/episode order. */
export function EpisodeViewsTable({
  episodes,
  caption = 'Views by episode',
}: {
  episodes: EpisodeViews[];
  caption?: string;
}) {
  if (episodes.length === 0) return <p>No episodes yet.</p>;
  return (
    <div className="table-scroll">
      <table className="studio-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Episode</th>
            <th scope="col">Name</th>
            <th scope="col">Views</th>
            <th scope="col">Finishes</th>
            <th scope="col">Finish rate</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((ep) => (
            <tr key={ep.episodeId}>
              <th scope="row">
                S{ep.season} E{ep.episode}
              </th>
              <td>{ep.name}</td>
              <td>{ep.views.toLocaleString()}</td>
              <td>{ep.finishes.toLocaleString()}</td>
              <td>{ep.views > 0 ? `${Math.round((ep.finishes / ep.views) * 100)}%` : 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Total views across a series' episodes, for a summary line. */
export function totalEpisodeViews(episodes: EpisodeViews[]): number {
  return episodes.reduce((sum, ep) => sum + ep.views, 0);
}
