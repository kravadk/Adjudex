export default function Loading() {
  return (
    <div className="min-h-screen bg-bg-0 p-6 text-text-primary">
      <div className="mx-auto max-w-7xl animate-pulse space-y-4">
        <div className="h-12 w-48 rounded-lg bg-bg-2" />
        <div className="h-52 rounded-2xl bg-bg-2" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-40 rounded-2xl bg-bg-2" />
          <div className="h-40 rounded-2xl bg-bg-2" />
        </div>
      </div>
    </div>
  );
}
