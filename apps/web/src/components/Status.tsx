/** Loading and error states that announce themselves to assistive tech. */

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="status" role="status">
      {label}…
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="status status-error" role="alert">
      {message}
    </p>
  );
}
