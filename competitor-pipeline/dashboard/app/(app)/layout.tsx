import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Column on a phone (nav bar on top, content below), row from md up
    // (sidebar beside content). w-screen is gone: with a horizontal
    // scrollbar present it is wider than the viewport, which produced a
    // sideways rock on touch even when nothing overflowed.
    <div className="flex h-screen w-full flex-col overflow-hidden md:flex-row">
      <Nav />
      {/* min-w-0 lets a wide table inside shrink and scroll in its own box
          instead of forcing the whole page wider than the screen. */}
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
