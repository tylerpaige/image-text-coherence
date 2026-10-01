"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "SEARCH" },
  { href: "/score", label: "SCORE" },
  { href: "/corpus", label: "CORPUS" },
  { href: "/interrogate", label: "INTERROGATE" },
];

export function PageHeader({ title }: { title: string }) {
  const pathname = usePathname();

  return (
    <>
      <h1 className="mb-4 border-b-4 border-black pb-3 text-3xl tracking-widest uppercase">
        {title}
      </h1>
      <nav className="mb-6 flex flex-wrap gap-2">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "border-2 border-black bg-black px-3 py-2 text-xs font-bold text-white"
                  : "border-2 border-black px-3 py-2 text-xs font-bold hover:bg-black hover:text-white"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
