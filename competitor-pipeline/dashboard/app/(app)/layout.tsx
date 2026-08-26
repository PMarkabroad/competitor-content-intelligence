import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Nav />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
