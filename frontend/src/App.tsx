import { Link, Outlet, type RouteObject } from "react-router";

function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="text-lg font-semibold">
            BioAccess
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function Home() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Welcome to BioAccess</h1>
      <p className="mt-2 text-slate-600">Face-recognition entry for your events.</p>
    </section>
  );
}

function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2">
        <Link to="/" className="text-blue-700 underline">
          Back home
        </Link>
      </p>
    </section>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
