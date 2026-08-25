import type { DailyPoint } from '@sweam/shared';

/** Recent daily counters, newest day first. */
export function DailyTable({ daily, days = 14 }: { daily: DailyPoint[]; days?: number }) {
  const rows = daily.slice(-days).reverse();
  if (rows.length === 0) return <p>No activity recorded yet.</p>;
  return (
    <div className="table-scroll">
      <table className="studio-table">
        <caption className="visually-hidden">Daily performance, newest day first</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Plays</th>
            <th scope="col">Finishes</th>
            <th scope="col">Likes</th>
            <th scope="col">Impressions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.day}>
              <th scope="row">{point.day}</th>
              <td>{point.plays.toLocaleString()}</td>
              <td>{point.completes.toLocaleString()}</td>
              <td>{point.likes.toLocaleString()}</td>
              <td>{point.impressions.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
