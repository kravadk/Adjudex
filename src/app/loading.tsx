export default function Loading() {
  return (
    <main className="min-h-screen bg-bg-0 p-6 text-text-primary">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="h-14 rounded-xl bg-bg-2" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-72 rounded-2xl bg-bg-2" />
          <div className="h-72 rounded-2xl bg-bg-2" />
        </div>
      </div>
    </main>
  );
}
