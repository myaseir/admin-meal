// app/admin/layout.tsx
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-6">
          <span className="font-black uppercase text-xs tracking-widest text-purple-600">
            Meal Bear Admin
          </span>
          <Link
            href="/admin/orders"
            className="text-[12px] font-bold uppercase tracking-widest text-gray-600 hover:text-purple-600 transition-colors"
          >
            Orders
          </Link>
          <Link
            href="/admin/assign-rider"
            className="text-[12px] font-bold uppercase tracking-widest text-gray-600 hover:text-purple-600 transition-colors"
          >
            Assign Rider
          </Link>
          <Link
            href="/admin/reports"
            className="text-[12px] font-bold uppercase tracking-widest text-gray-600 hover:text-purple-600 transition-colors"
          >
            Reports
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}